// async & chokidar Code written by Cal2195
// Was originally added to `main-extract.ts` but was moved here for clarity

const { powerSaveBlocker, nativeImage } = require('electron');
const async = require('async');
const chokidar = require('chokidar');
import * as path from 'path';
import type { FSWatcher } from 'chokidar'; // probably the correct type for chokidar.watch() object
const fs = require('fs');
import { fdir } from 'fdir';

import { GLOBALS } from './main-globals';

import type { ImageElement, ImageElementPlus } from '../interfaces/final-object.interface';
import { acceptableFiles } from './main-filenames';
import { extractAll, stripGoodFrames, setParallelWorkersForTimeouts } from './main-extract';
import { extractCover } from './main-covers';
import { sendCurrentProgress, insertTemporaryFieldsSingle, extractMetadataAsync, cleanUpFileName } from './main-support';

export interface TempMetadataQueueObject {
  fullPath: string;
  inputSource: number;
  name: string;
  partialPath: string;
}

// ONLY FOR LOGGING
const { performance } = require('perf_hooks');

// =====================================================================================================================
// The three queues will be `QueueObject` - https://caolan.github.io/async/v3/docs.html#QueueObject

// meta queue
let metadataQueue;      // QueueObject - accepts a `.push(TempMetadataQueueObject)`
let metaDone = 0;
let metaExtractionStartTime = 0;

// thumb queue
let thumbQueue;         // QueueObject
let thumbsDone = 0;
let thumbExtractionStartTime = 0;

// delete queue
let deleteThumbQueue;   // QueueObject
let numberOfThumbsDeleted = 0;

// =====================================================================================================================

// Create maps where the value = 1 always.
// It is faster to check if key exists than searching through an array.
// full paths to videos we have metadata for in Angular (+ what we need to notice a changed file)
interface KnownFile {
  size: number;
  mtime: number;
  hash: string;
  duration: number;
  width: number;
  height: number;
}
let alreadyInAngular: Map<string, KnownFile> = new Map();

function knownOf(el: ImageElement): KnownFile {
  return { size: el.fileSize, mtime: el.mtime, hash: el.hash, duration: el.duration, width: el.width, height: el.height };
}

// cover queue (WsQ) -- cover art from file metadata
let coverQueue;          // QueueObject - accepts `{ fullPath, hash }`

// WsQ: how many ffmpeg / ffprobe jobs run at the same time (Settings -> Look -> parallel processes)
let workerCount = 3;

export function setWorkerCount(n: number): void {
  workerCount = Math.max(1, Math.min(8, Math.round(n) || 1));
  [thumbQueue, coverQueue].forEach(q => {
    if (q) {
      q.concurrency = workerCount;
    }
  });
  if (metadataQueue) {
    metadataQueue.concurrency = Math.min(2, workerCount);   // metadata is quick; more readers only fight over the disk
  }
  setParallelWorkersForTimeouts(workerCount);
  console.log('parallel workers:', workerCount);
}

// WsQ: hold the cover + thumbnail work (e.g. while old covers are scaled down), then go on
let pauseToken = 0;
export function pauseCoverWork(): number {
  [thumbQueue, coverQueue].forEach(q => q && q.pause());
  return ++pauseToken;
}
export function resumeCoverWork(token: number): void {
  if (token !== pauseToken) {
    return;   // a newer pause (another hub opened) is in charge
  }
  [thumbQueue, coverQueue].forEach(q => q && q.resume());
}

// changed files queue (WsQ) -- files already in the hub whose size / modification time changed
let changedQueue;        // QueueObject - accepts `{ fullPath, inputSource, partialPath, fileName }`

// These two are together:
const watcherMap:       Map<number, FSWatcher> = new Map();
let allFoundFilesMap: Map<number, Map<string, 1>> = new Map();
// both these numbers     ^^^^^^ match up - they refer to the same `inputSource`

// =====================================================================================================================

// Miscellaneous
let preventSleepIds: number[] = []; // prevent and allow sleep

// =====================================================================================================================

resetAllQueues();

/**
 * Reset all three queues:
 *  - Meta queue
 *  - Thumb queue
 *  - Delet queue
 */
export function resetAllQueues(): void {

  allowSleep();

  // kill all previeous
  if (thumbQueue && typeof thumbQueue.kill === 'function') {
    thumbQueue.kill();
  }
  if (metadataQueue && typeof metadataQueue.kill === 'function') {
    metadataQueue.kill();
  }
  if (deleteThumbQueue && typeof deleteThumbQueue.kill === 'function') {
    deleteThumbQueue.kill();
  }
  if (coverQueue && typeof coverQueue.kill === 'function') {
    coverQueue.kill();
  }
  if (changedQueue && typeof changedQueue.kill === 'function') {
    changedQueue.kill();
  }

  pauseToken++;   // WsQ: fresh queues are not paused
  coverQueue = async.queue(coverQueueRunner, workerCount);
  changedQueue = async.queue(changedQueueRunner, 1);

  // Meta queue ========================================================================================================
  metaDone = 0;
  metaExtractionStartTime = 0;

  metadataQueue = async.queue(metadataQueueRunner, Math.min(2, workerCount)); // WsQ: parallel workers (Settings)
                                                       // ^--- experiment with numbers to see what is fastest (try 8)

  metadataQueue.drain(() => {

    thumbQueue.resume();

    logPerformance('META QUEUE took ', metaExtractionStartTime);
  });

  // Thumbs queue ======================================================================================================
  thumbsDone = 0;
  thumbExtractionStartTime = 0;

  thumbQueue = async.queue(thumbQueueRunner, workerCount); // WsQ: parallel ffmpeg processes (Settings)

  thumbQueue.drain(() => {

    logPerformance('THUMB QUEUE took ', thumbExtractionStartTime);

    thumbsDone = 0;
    sendCurrentProgress(1, 1, 'done');
    console.log('thumbnail extraction complete!');
    allowSleep();
  });

  // Delete queue ======================================================================================================
  deleteThumbQueue = async.queue(deleteThumbQueueRunner, 1);

  deleteThumbQueue.drain(() => {
    console.log('all screenshots now deleted');
    GLOBALS.angularApp.sender.send('number-of-screenshots-deleted', numberOfThumbsDeleted);
  });
}

/**
 * Extraction queue runner
 * Runs for every element in the `thumbQueue`
 * @param element -- ImageElement to extract screenshots for
 * @param done    -- callback to indicate the current extraction finished
 */
// WsQ: what is being worked on right now (status bar popup) and which files still miss pictures
const activeJobs = new Map<string, { name: string, folder: string, step: string, since: number }>();
let activeTimer: any = null;
const queuedHashes: string[] = [];
let queuedTimer: any = null;

function sendActive(): void {
  if (activeTimer) {
    return;
  }
  activeTimer = setTimeout(() => {
    activeTimer = null;
    try {
      GLOBALS.angularApp.sender.send('wsq-active-jobs', Array.from(activeJobs.values()), thumbQueue ? thumbQueue.length() : 0, coverQueue ? coverQueue.length() : 0);
    } catch (e) { }
  }, 300);
}

function setActive(key: string, el: { fileName?: string, partialPath?: string, fullPath?: string }, step: string | null): void {
  if (step === null) {
    activeJobs.delete(key);
  } else {
    const name = el.fileName || (el.fullPath ? path.basename(el.fullPath) : key);
    const folder = el.partialPath || (el.fullPath ? path.dirname(el.fullPath) : '');
    const prev = activeJobs.get(key);
    activeJobs.set(key, { name, folder, step, since: prev ? prev.since : Date.now() });
  }
  sendActive();
}

function flushQueued(): void {
  if (queuedTimer) {
    clearTimeout(queuedTimer);
    queuedTimer = null;
  }
  if (queuedHashes.length) {
    try { GLOBALS.angularApp.sender.send('wsq-thumbs-queued', queuedHashes.splice(0)); } catch (e) { }
  }
}

function noteQueued(hash: string): void {
  queuedHashes.push(hash);
  if (!queuedTimer) {
    queuedTimer = setTimeout(() => {
      queuedTimer = null;
      try { GLOBALS.angularApp.sender.send('wsq-thumbs-queued', queuedHashes.splice(0)); } catch (e) { }
    }, 500);
  }
}

/**
 * WsQ: covers first -- while the cover queue has work, thumbnail / filmstrip workers wait.
 * Covers are quick; without this both fight over the disk and ffmpeg runs out of time,
 * which is how broken (black / missing) filmstrips came out. Waits at most 15 min.
 */
function thumbQueueRunner(element: ImageElement, queueDone): void {
  const start = Date.now();
  const busy = () => coverQueue && (coverQueue.length() + coverQueue.running()) > 0 && !coverQueue.paused;
  if (!busy()) {
    thumbQueueRunnerInner(element, queueDone);
    return;
  }
  setActive('t:' + element.hash, element, 'wait');
  const tick = () => {
    if (!busy() || Date.now() - start > 15 * 60 * 1000) {
      thumbQueueRunnerInner(element, queueDone);
    } else {
      setTimeout(tick, 400);
    }
  };
  setTimeout(tick, 400);
}

function thumbQueueRunnerInner(element: ImageElement, queueDone): void {
  // WsQ: watchdog -- one broken file must never stop the whole queue
  let finished = false;
  setActive('t:' + element.hash, element, 'check');
  const done = () => {
    if (!finished) {
      finished = true;
      setActive('t:' + element.hash, element, null);
      flushQueued();   // "queued" must reach Angular before "ready"
      clearTimeout(watchdog);
      try {
        GLOBALS.angularApp.sender.send('wsq-thumb-ready', element.hash);
      } catch (e) { }
      queueDone();
    }
  };
  const watchdog = setTimeout(() => {
    console.log('THUMB WATCHDOG: skipping', element.fileName);
    done();
  }, 10 * 60 * 1000);

  const screenshotOutputFolder: string = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName);
  const shouldExtractClips: boolean = GLOBALS.screenshotSettings.clipSnippets > 0;

  // WsQ: a file with cover art does not need the single-frame thumbnail -- find out about the cover first
  coverOf(element)
    .then((hasCover: boolean) => hasAllThumbs(element.hash, screenshotOutputFolder, shouldExtractClips, hasCover)
      .then(() => done())
      .catch(() => runExtraction(hasCover)));

  const runExtraction = (hasCover: boolean) => {
      setActive('t:' + element.hash, element, 'filmstrip');
      sendCurrentProgress( // TODO check whether sending data off by 1
        thumbsDone,
        thumbsDone + thumbQueue.length() + 1,
        'importingScreenshots'
      );
      thumbsDone++;

      extractAll(
        element,
        GLOBALS.selectedSourceFolders[element.inputSource].path,
        screenshotOutputFolder,
        GLOBALS.screenshotSettings,
        done,   // WsQ: the filmstrip is checked (and remade if needed) inside extractAll
        hasCover
      );
  };
}

/**
 * Send element back to Angular; if any screenshots missing, queue it for extraction
 * @param imageElement
 */
// WsQ: folder the user is looking at -- its files jump the queues, also the ones found later
let priorityPrefix = '';

function inPriority(partialPath: string): boolean {
  if (!priorityPrefix) {
    return false;
  }
  const p = (partialPath || '').replace(/\\/g, '/');
  return p === priorityPrefix || p.startsWith(priorityPrefix + '/');
}

function pushThumb(el: ImageElement): void {
  noteQueued(el.hash);
  if (inPriority(el.partialPath)) {
    thumbQueue.unshift(el);
  } else {
    thumbQueue.push(el);
  }
}

function pushMeta(item: TempMetadataQueueObject): void {
  if (inPriority(item.partialPath)) {
    metadataQueue.unshift(item);
  } else {
    metadataQueue.push(item);
  }
}

function sendNewVideoMetadata(imageElement: ImageElementPlus): void {

  alreadyInAngular.set(imageElement.fullPath, knownOf(imageElement));

  coverQueue.push({ fullPath: imageElement.fullPath, hash: imageElement.hash });

  delete imageElement.fullPath; // downgrade to `ImageElement` from `ImageElementPlus`

  const elementForAngular = insertTemporaryFieldsSingle(imageElement);
  GLOBALS.angularApp.sender.send('new-video-meta', elementForAngular);

  if (thumbExtractionStartTime === 0) {
    thumbExtractionStartTime = performance.now();
  }

  pushThumb(imageElement);
}

/**
 * Create empty element, extract and update metadata, send over to Angular
 * @param fileInfo - various stat metadata about the file
 * @param done
 */
export function metadataQueueRunner(file: TempMetadataQueueObject, done): void {

  if (metaExtractionStartTime === 0) {
    metaExtractionStartTime = performance.now();
  }

  if (GLOBALS.demo && alreadyInAngular.size >= 50) {
    console.log(' - DEMO LIMIT REACHED - CANCELING SCAN !!!');
    sendCurrentProgress(50, 50, 'done');
    metadataQueue.kill();
    thumbQueue.resume();
    return;
  }

  sendCurrentProgress(metaDone, metaDone + metadataQueue.length() + 1, 'importingMeta');
  metaDone++;

  extractMetadataAsync(file.fullPath, GLOBALS.screenshotSettings)
    .then((imageElement: ImageElementPlus) => {
      imageElement.cleanName = cleanUpFileName(file.name);
      imageElement.fileName = file.name;
      imageElement.fullPath = file.fullPath; // insert this converting `ImageElement` to `ImageElementPlus`
      imageElement.inputSource = file.inputSource;
      imageElement.partialPath = file.partialPath;
      sendNewVideoMetadata(imageElement);
      done();
    }, () => {
      done(); // error, just continue
    });

}

/**
 * Use `fdir` to quickly generate file list and add it to `metadataQueue`
 * @param inputDir    -- full path to the input folder
 * @param inputSource -- the number corresponding to the `inputSource` in ImageElement -- must be set!
 */
function superFastSystemScan(inputDir: string, inputSource: number): void {

  GLOBALS.angularApp.sender.send('started-watching-this-dir', inputSource);

  metadataQueue.pause();
  thumbQueue.pause();

  const crawler = new fdir()
    .exclude((dir: string) => dir.startsWith('vha-')) // .exclude `dir` is the folder name, not full path
    .withFullPaths()
    .crawl(inputDir);

  const t0 = performance.now(); // LOGGING

  crawler.withPromise().then((files: string[]) => {

    // LOGGING =====================================================================================
    logPerformance('scan took ', t0);
    console.log('Found ', files.length, ' files in given directory');
    // =============================================================================================

    const allAcceptableFiles: string[] = [...acceptableFiles, ...GLOBALS.additionalExtensions];

    files.forEach((fullPath: string) => {

      const parsed = path.parse(fullPath);

      if (!allAcceptableFiles.includes(parsed.ext.substr(1).toLowerCase())) {
        return;
      }

      if (!allFoundFilesMap.has(inputSource)) {
        allFoundFilesMap.set(inputSource, new Map());
      }
      allFoundFilesMap.get(inputSource).set(fullPath, 1);

      const partial: string = path.relative(inputDir, parsed.dir).replace(/\\/g, '/');

      if (alreadyInAngular.has(fullPath)) {
        changedQueue.push({ fullPath, inputSource, partialPath: '/' + partial, fileName: parsed.base });
        return;
      }

      const newItem: TempMetadataQueueObject = {
        fullPath: fullPath,
        inputSource: inputSource,
        name: parsed.base,
        partialPath: '/' + partial,
      };

      pushMeta(newItem);

    });

    GLOBALS.angularApp.sender.send('all-files-found-in-dir', inputSource, allFoundFilesMap.get(inputSource));

    metadataQueue.resume();

    // WsQ: nothing new to import -> the metadata `drain` never fires, so resume the thumbnails here
    if (metadataQueue.idle()) {
      thumbQueue.resume();
    }

  }).catch((err) => {
    // WsQ: folder missing / disk not connected -- don't leave both queues paused forever
    console.log('SCAN FAILED for', inputDir, err && err.message);
    metadataQueue.resume();
    if (metadataQueue.idle()) {
      thumbQueue.resume();
    }
  });

}

/**
 * Create a new `chokidar` watcher for a particular directory
 * @param inputDir    -- full path to input folder
 * @param inputSource -- the number corresponding to the `inputSource` in ImageElement -- must be set!
 * @param persistent  -- whether to continue watching after the initial scan
 */
export function startFileSystemWatching(inputDir: string, inputSource: number, persistent: boolean): void {

  // only run `chokidar` if `persistent`
  if (!persistent) {
    superFastSystemScan(inputDir, inputSource);
    return;
  }

  const t0 = performance.now();

  console.log('================================================================');
  console.log('SHOULD ONLY RUN ON PERSISTENT SCAN !!!');

  console.log('starting watcher ', inputSource, typeof(inputSource), inputDir);

  // WARNING - there are other ways to have a network address that are not accounted here !!!
  const isNetworkAddress: boolean =    inputDir.startsWith('//')
                                    || inputDir.startsWith('\\\\');

  // WsQ: the first pass is the fast `fdir` scan; chokidar only reports changes from now on
  // (an initial chokidar pass over thousands of files kept the main process -- and the window -- busy)
  superFastSystemScan(inputDir, inputSource);

  const watcherConfig = {
    cwd: inputDir,
    disableGlobbing: true,
    ignoreInitial: true,
    ignored: 'vha-*', // WARNING - dangerously ignores any path that includes `vha-` anywhere!!!
    persistent: true, // NOTE: if `!persistent` we use `superFastSystemScan()` instead !!!
    usePolling: isNetworkAddress ? true : false,
  };

  const watcher: FSWatcher = chokidar.watch(inputDir, watcherConfig);

  const allAcceptableFiles: string[] = [...acceptableFiles, ...GLOBALS.additionalExtensions];

  watcher
    .on('add', (filePath: string) => {

      const ext = filePath.substring(filePath.lastIndexOf('.') + 1).toLowerCase();

      if (!allAcceptableFiles.includes(ext)) {
        return;
      }

      const subPath = ('/' + filePath.replace(/\\/g, '/')).replace('//', '/');
      const partialPath = subPath.substring(0, subPath.lastIndexOf('/'));
      const fileName = subPath.substring(subPath.lastIndexOf('/') + 1);
      const fullPath = path.join(inputDir, partialPath, fileName);

      if (!allFoundFilesMap.has(inputSource)) {
        allFoundFilesMap.set(inputSource, new Map());
      }
      allFoundFilesMap.get(inputSource).set(fullPath, 1);

      if (alreadyInAngular.has(fullPath)) {
        changedQueue.push({ fullPath, inputSource, partialPath, fileName });
        return;
      }

      const newItem: TempMetadataQueueObject = {
        fullPath: fullPath,
        inputSource: inputSource,
        name: fileName,
        partialPath: partialPath,
      };

      pushMeta(newItem);
    })
    .on('change', (filePath: string) => {
      const subPath = ('/' + filePath.replace(/\\/g, '/')).replace('//', '/');
      const partialPath = subPath.substring(0, subPath.lastIndexOf('/'));
      const fileName = subPath.substring(subPath.lastIndexOf('/') + 1);
      const fullPath = path.join(inputDir, partialPath, fileName);
      if (alreadyInAngular.has(fullPath)) {
        changedQueue.push({ fullPath, inputSource, partialPath, fileName });
      }
    })
    .on('unlink', (partialFilePath: string) => {    // note: this happens even when file is renamed!
      console.log(' !!! FILE DELETED, updating Angular:', partialFilePath);
      GLOBALS.angularApp.sender.send('single-file-deleted', inputSource, partialFilePath);
      // remove element from `alreadyInAngular`
      const basePath: string = GLOBALS.selectedSourceFolders[inputSource].path;
      alreadyInAngular.delete(path.join(basePath, partialFilePath));
      // note: there is no need to watch for `unlinkDir` since `unlink` fires for every file anyway!
    })
    .on('ready', () => {
      console.log('Watcher ready', inputSource);

      metadataQueue.resume();
      if (metadataQueue.idle()) {
        thumbQueue.resume();
      }

      if (persistent) {
        console.log('^^^^^^^^ - CONTINUING to watch this directory!');
      } else {
        console.log('^^^^^^^^ - stopping watching this directory');
        watcher.close();  // chokidar seems to disregard `persistent` when `fsevents` is not enabled
      }

      logPerformance('Chokidar took ', t0);
    });

  watcherMap.set(inputSource, watcher);
}

/**
 * Close out all the wathers
 * reset the alreadyInAngular
 * @param finalArray
 */
export function resetWatchers(finalArray: ImageElement[]): void {

  // close every old watcher
  Array.from(watcherMap.keys()).forEach((key: number) => {
    closeWatcher(key);
  });

  alreadyInAngular = new Map();

  allFoundFilesMap = new Map();

  finalArray.forEach((element: ImageElement) => {
    const fullPath: string = path.join(
      GLOBALS.selectedSourceFolders[element.inputSource].path,
      element.partialPath,
      element.fileName
    );

    alreadyInAngular.set(fullPath, knownOf(element));
  });
}

/**
 * Close the old watcher
 * happens when opening a new hub (or user toggles the `watch` near folder)
 * @param inputSource
 */
export function closeWatcher(inputSource: number): void {
  console.log('stop watching', inputSource);
  if (watcherMap.has(inputSource)) {
    console.log('closing ', inputSource);
    watcherMap.get(inputSource).close().then(() => {
      console.log(inputSource, ' closed!');
      // do nothing
    });
  }
}

/**
 * Start old watcher
 * happens when user toggles the `watch` near folder
 * @param inputSource
 * @param folderPath
 */
export function startWatcher(inputSource: number, folderPath: string, persistent: boolean): void {
  console.log('start watching !!!!', inputSource, typeof(inputSource), folderPath, persistent);

  GLOBALS.selectedSourceFolders[inputSource] = {
    path: folderPath,
    watch: persistent,
  };

  preventSleep();
  startFileSystemWatching(folderPath, inputSource, persistent);
}

/**
 * Check if thumbnail, flimstrip, and clip is present
 * return boolean
 * @param fileHash           - unique identifier of the file
 * @param screenshotFolder   - path to where thumbnails are
 * @param shouldExtractClips - whether or not to extract clips
 */
function hasAllThumbs(
  fileHash: string,
  screenshotFolder: string,
  shouldExtractClips: boolean,
  hasCover = false
): Promise<boolean> {
  return new Promise((resolve, reject) => {

    const thumb: string =     path.join(screenshotFolder, '/thumbnails/', fileHash + '.jpg');
    const filmstrip: string = path.join(screenshotFolder, '/filmstrips/', fileHash + '.jpg');
    const clip: string =      path.join(screenshotFolder, '/clips/',      fileHash + '.mp4');
    const clipThumb: string = path.join(screenshotFolder, '/clips/',      fileHash + '.jpg');

    Promise.all([
      hasCover ? 'ok' : fs.promises.access(thumb, fs.constants.F_OK),
      fs.promises.access(filmstrip, fs.constants.F_OK),
      shouldExtractClips
        ? fs.promises.access(clip, fs.constants.F_OK)
        : 'ok',
      shouldExtractClips
        ? fs.promises.access(clipThumb, fs.constants.F_OK)
        : 'ok'
    ])
      .then(() => {
        resolve(true);
      })
      .catch(() => {
        reject();
      });
  });
}

/**
 * Send all `imageElements` to the `thumbQueue`
 * @param fullArray          - ImageElement array
 */
export function extractAnyMissingThumbs(fullArray: ImageElement[]): void {
  // WsQ: queue only the files that really miss something, so the progress shows what is left
  const screenshotOutputFolder: string = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName);
  const shouldExtractClips: boolean = GLOBALS.screenshotSettings.clipSnippets > 0;
  const candidates = (fullArray || []).filter((element: ImageElement) =>
    element && element.hash && !(element as any).deleted && element.cleanName !== '*FOLDER*');

  Promise.all(candidates.map(el =>
    hasAllThumbs(el.hash, screenshotOutputFolder, shouldExtractClips, (el as any).cover > 0).then(() => null, () => el)
  )).then((missing: ImageElement[]) => {
    const todo = missing.filter(Boolean);
    console.log('missing thumbnails:', todo.length);
    if (!todo.length) {
      return;
    }
    preventSleep();
    if (thumbExtractionStartTime === 0) {
      thumbExtractionStartTime = performance.now();
    }
    todo.forEach(el => pushThumb(el));
    // the queue may still be paused after a folder scan -- go on if nothing is being imported
    if (metadataQueue.idle()) {
      thumbQueue.resume();
    }
  });
}

/**
 * !!! WARNING !!! THIS FUNCTION WILL DELETE STUFF !!!
 *
 * Scan the provided directory and delete any file not in `hashesPresent`
 * @param hashesPresent
 * @param directory
 */
export function removeThumbnailsNotInHub(hashesPresent: Map<string, 1>, directory: string): void {

  deleteThumbQueue.pause();
  numberOfThumbsDeleted = 0;

  const crawler = new fdir()
    .withFullPaths()
    .filter((file: string) => {
      const  it: string = file.toLowerCase();
      return it.endsWith('.jpg') || it.endsWith('.mp4');
    })
    .crawl(directory);

  crawler.withPromise().then((files: string[]) => {

    files.forEach((file: string) => {
      const parsedPath = path.parse(file);
      const fileNameHash = parsedPath.name;

      if (!hashesPresent.has(fileNameHash)) {
        deleteThumbQueue.push(file);
        numberOfThumbsDeleted++;
      }
    });

    if (numberOfThumbsDeleted === 0) {
      GLOBALS.angularApp.sender.send('number-of-screenshots-deleted', 0);
    } else {
      deleteThumbQueue.resume(); // else only send message after the delete queue is finished
    }

  });

}

function deleteThumbQueueRunner(pathToFile: string, done): void {
  console.log('deleting:', pathToFile);

  fs.unlink(pathToFile, (err) => {
    done();
  });
}

/**
 * Prevent PC from going to sleep during screenshot extraction
 */
export function preventSleep(): void {
  console.log('preventing sleep');
  preventSleepIds.push(powerSaveBlocker.start('prevent-app-suspension'));
}

/**
 * Allow PC to go to sleep after screenshots were extracted
 */
function allowSleep(): void {
  console.log('allowing sleep');
  if (preventSleepIds.length) {
    preventSleepIds.forEach((id: number) => {
      powerSaveBlocker.stop(id);
    });
  }
  preventSleepIds = [];
}

function logPerformance(message: string, initial: number): void {
  console.log(message + Math.round((performance.now() - initial) / 100) / 10 + ' seconds.');
}


// =====================================================================================================================
// WsQ: covers from metadata + changed files
// =====================================================================================================================

function coversFolder(): string {
  return path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName, 'covers');
}

/**
 * WsQ: does this file have cover art? Cover file already there -> yes; checked before without a cover -> no;
 * otherwise extract it now (and tell Angular, like the cover queue does)
 */
function coverOf(element: ImageElement): Promise<boolean> {
  const coverFile = path.join(coversFolder(), element.hash + '.jpg');
  return fs.promises.access(coverFile, fs.constants.F_OK)
    .then(() => true)
    .catch(() => {
      if ((element as any).cover === 0) {
        return false;
      }
      const src = GLOBALS.selectedSourceFolders[element.inputSource];
      if (!src) {
        return false;
      }
      const fullPath = path.join(src.path, element.partialPath, element.fileName);
      return extractCover(fullPath, element.hash, coversFolder())
        .then((has: boolean | null) => {
          if (has === null) {
            return false;   // unknown now -- the cover queue tries again, do not mark "no cover"
          }
          try {
            GLOBALS.angularApp.sender.send('cover-result', element.hash, has ? Date.now() : 0);
          } catch { }
          return has;
        })
        .catch(() => false);
    });
}

function coverQueueRunner(job: { fullPath: string, hash: string, tries?: number }, queueDone): void {
  setActive('c:' + job.hash, job, 'cover');
  const done = () => { setActive('c:' + job.hash, job, null); queueDone(); };
  extractCover(job.fullPath, job.hash, coversFolder())
    .then((has: boolean | null) => {
      if (has === null) {
        // WsQ: reading failed (disk busy / timeout) -- try again later instead of marking "no cover" for good
        const tries = (job.tries || 0) + 1;
        if (tries <= 3) {
          setTimeout(() => coverQueue.push({ ...job, tries }), 20000 * tries);
          done();
          return;
        }
        has = false;
      }
      try {
        GLOBALS.angularApp.sender.send('cover-result', job.hash, has ? Date.now() : 0);
      } catch { }
      done();
    })
    .catch(() => done());
}

/**
 * Angular asks to (re)check covers of these files (first run of a hub, "refresh cover", "check all")
 */
export function checkCovers(jobs: { fullPath: string, hash: string }[], now = false): void {
  if (now) {
    jobs.slice().reverse().forEach(j => coverQueue.unshift(j));   // WsQ: asked by hand -> before the background checks
    return;
  }
  jobs.forEach(j => {
    if (coverInPriority(j.fullPath)) {
      coverQueue.unshift(j);
    } else {
      coverQueue.push(j);
    }
  });
}

/** WsQ: is this file (full path) inside the folder the user has open? */
function coverInPriority(fullPath: string): boolean {
  if (!priorityPrefix || !fullPath) {
    return false;
  }
  const p = fullPath.replace(/\\/g, '/').toLowerCase();
  const pre = '/' + priorityPrefix.replace(/^\/+/, '').toLowerCase();
  return p.includes(pre + '/');
}

/**
 * A file we already know: if its size or modification time changed, re-read the metadata.
 * Same duration and resolution = same video (e.g. only a cover was added) -> keep the old hash and screenshots,
 * otherwise use the new hash and extract new screenshots.
 */
function changedQueueRunner(job: { fullPath: string, inputSource: number, partialPath: string, fileName: string }, done): void {
  const known = alreadyInAngular.get(job.fullPath);
  if (!known) {
    done();
    return;
  }
  fs.stat(job.fullPath, (err, st) => {
    if (err || (st.size === known.size && Math.round(st.mtimeMs) === known.mtime)) {
      done();
      return;
    }
    extractMetadataAsync(job.fullPath, GLOBALS.screenshotSettings)
      .then((el: ImageElementPlus) => {
        const sameVideo = el.duration === known.duration && el.width === known.width && el.height === known.height;
        if (sameVideo) {
          el.hash = known.hash;
        }
        el.cleanName = cleanUpFileName(job.fileName);
        el.fileName = job.fileName;
        el.inputSource = job.inputSource;
        el.partialPath = job.partialPath;
        alreadyInAngular.set(job.fullPath, knownOf(el));

        const forAngular = insertTemporaryFieldsSingle(Object.assign({}, el));
        delete (forAngular as any).fullPath;
        GLOBALS.angularApp.sender.send('video-file-changed', forAngular, known.hash);

        if (!sameVideo) {
          pushThumb(el);
        }
        coverQueue.push({ fullPath: job.fullPath, hash: el.hash });
        done();
      }, () => done());
  });
}


/**
 * WsQ: move the files of the folder the user is looking at to the front of the queues
 * @param hashes        -- files in the current view (thumbnails first for these)
 * @param partialPrefix -- current folder ('/a/b'); new files below it get their metadata first ('' = no folder)
 */
export function prioritizeView(hashes: string[], partialPrefix: string): void {
  try {
    priorityPrefix = (partialPrefix || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (thumbQueue && ((hashes && hashes.length) || priorityPrefix)) {
      const wanted = new Set(hashes || []);
      const moved: ImageElement[] = [];
      thumbQueue.remove(({ data }) => {
        if (data && (wanted.has(data.hash) || inPriority(data.partialPath))) {
          moved.push(data);
          return true;
        }
        return false;
      });
      // keep the on-screen order: unshift from the last one
      const order = new Map<string, number>();
      (hashes || []).forEach((h, i) => order.set(h, i));
      moved.sort((a, b) => (order.has(a.hash) ? order.get(a.hash) : 1e9) - (order.has(b.hash) ? order.get(b.hash) : 1e9));
      for (let i = moved.length - 1; i >= 0; i--) {
        thumbQueue.unshift(moved[i]);
      }
      if (moved.length) {
        console.log('prioritized thumbnails:', moved.length);
      }
    }
    // WsQ: covers of the open folder first too
    if (coverQueue && ((hashes && hashes.length) || priorityPrefix)) {
      const wanted = new Set(hashes || []);
      const movedCovers: { fullPath: string, hash: string }[] = [];
      coverQueue.remove(({ data }) => {
        if (data && (wanted.has(data.hash) || coverInPriority(data.fullPath))) {
          movedCovers.push(data);
          return true;
        }
        return false;
      });
      const order = new Map<string, number>();
      (hashes || []).forEach((h, i) => order.set(h, i));
      movedCovers.sort((a, b) => (order.has(a.hash) ? order.get(a.hash) : 1e9) - (order.has(b.hash) ? order.get(b.hash) : 1e9));
      for (let i = movedCovers.length - 1; i >= 0; i--) {
        coverQueue.unshift(movedCovers[i]);
      }
      if (movedCovers.length) {
        console.log('prioritized covers:', movedCovers.length);
      }
    }
    if (metadataQueue && partialPrefix) {
      const pre = partialPrefix.replace(/\\/g, '/');
      const movedMeta: TempMetadataQueueObject[] = [];
      metadataQueue.remove(({ data }) => {
        const p = data && data.partialPath ? data.partialPath.replace(/\\/g, '/') : '';
        if (p === pre || p.startsWith(pre + '/')) {
          movedMeta.push(data);
          return true;
        }
        return false;
      });
      for (let i = movedMeta.length - 1; i >= 0; i--) {
        metadataQueue.unshift(movedMeta[i]);
      }
      if (movedMeta.length) {
        console.log('prioritized new files:', movedMeta.length);
      }
    }
  } catch (e) {
    console.log('prioritizeView failed', e);
  }
}


/**
 * WsQ: right-click -> make the filmstrips (and the frame thumbnail) again for these files, first in the queue
 */
export function regenerateFilmstrips(elements: ImageElement[]): void {
  const out = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName);
  (elements || []).filter(el => el && el.hash && el.cleanName !== '*FOLDER*').reverse().forEach(el => {
    ['filmstrips', 'thumbnails'].forEach(dir => {
      try { fs.unlinkSync(path.join(out, dir, el.hash + '.jpg')); } catch (e) { }
    });
    noteQueued(el.hash);
    thumbQueue.unshift(el);
  });
  if (thumbExtractionStartTime === 0) {
    thumbExtractionStartTime = performance.now();
  }
  preventSleep();
  thumbQueue.resume();
}


// =====================================================================================
// WsQ: is a filmstrip really there? (missing, unreadable or all black = bad)
// =====================================================================================

const retriedStrips = new Set<string>();

export function filmstripBad(hash: string, screens = 10): boolean {
  const file = path.join(GLOBALS.selectedOutputFolder, 'vha-' + GLOBALS.hubName, 'filmstrips', hash + '.jpg');
  const n = Math.max(1, screens || 10);
  return stripGoodFrames(file, n) < Math.ceil(n / 2);
}

/**
 * WsQ: check the filmstrips of these files (missing or all black) and generate the bad ones again
 */
export function verifyFilmstrips(elements: ImageElement[]): void {
  const list = (elements || []).filter(el => el && el.hash && el.cleanName !== '*FOLDER*');
  const bad: ImageElement[] = [];
  let i = 0;
  const send = (finished: boolean) => {
    try { GLOBALS.angularApp.sender.send('wsq-verify-progress', i, list.length, bad.length, finished); } catch (e) { }
  };
  const step = () => {
    const end = Math.min(list.length, i + 20);
    for (; i < end; i++) {
      if (filmstripBad(list[i].hash, list[i].screens)) {
        bad.push(list[i]);
      }
    }
    send(false);
    if (i < list.length) {
      setImmediate(step);
      return;
    }
    send(true);
    console.log('filmstrip verify:', list.length, 'checked,', bad.length, 'bad');
    if (bad.length) {
      bad.forEach(el => retriedStrips.delete(el.hash));
      regenerateFilmstrips(bad);
    }
  };
  step();
}
