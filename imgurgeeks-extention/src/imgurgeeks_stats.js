'use strict';

/**
 * Coding rules
 *  No external js libraries. Complicates Chrome Store's security review.
 *  Assume Chrome Only (so ES6, css, etc)
 *  Use async/await
 *  No reactive library or even jquery (for now)
 *
 *  Some thoughts on image views data. It has the potential to be massive and likely has a "long tail"
 *  of low view images.
 *
 *  Each piece of data is relatively small but trying to manipulate by loading it all into memory
 *  might fall over on lower-end user's machines.. (aka remember we're not running on a server)
 *
 *  Don't use localStorage to hold bulk data since the extensions shares namespace with imgur.com
 *  We could use the extension's localStorage namespace, but we'd have to shuffle all the data
 *  to the background page and store it there. But that has added complexity of serializing
 *  all the data across sandboxes.
 *
 *  So, we use the WebCache and store our bulk data there.
 *
 *  Data Refresh thoughts:
 *  We want to play nice with imgur so we do partial data refreshes:
 *      1. Load existing data
 *      2. Fetch partial new/updated data
 *      3. Merge into existing data
 *      4. Save.
 *  Cons:
 *    - This means we can't detect deletes.
 *    - Merge requires loading all existing data into memory. We could get around this by moving the Hash=>score
 *    data into localStorage, but we'd have to serialize data across sandboxes to the background. Which might
 *    work since we get it in bulk.
 *
 *
 * TODO:
 *  - Tried to handle case where users switches profiles, need to test.
 *  - We *could* build a user vs user scoreboard of top 50 images (from public posts data). Might be fun
 *    as a server project. IronGif scoreboard.
 *
 *  Imgur: Tried to make this extension play nice with the servers.
 *         Contact me directly on the imgur discord server if you have any issues/concerns. Sarah knows
 *         who I am.
 */


try {   // scope and prevent errors from leaking out to page.

// single point to turn on/off console. todo: tie into Settings to help users debug issues?
  const TESTERS_GET_EXTRA_FEATURES = true;

  const ERR_BREAK_ENABLED = true;
  const TRACE_ENABLED = false;
  const TEST_LIMIT_DATA = false;    // used for testing full data logic without doing EVERYTHING.


  /* eslint-disable: no-console no-undef no-octal-escape no-octal */
  const logerr = (...args) => {
    if (TRACE_ENABLED === false) {
      return
    }
    console.log('%c imgurgeeks-tool ', 'color: white; font-weight: bold; background-color: red', ...args);
    if (ERR_BREAK_ENABLED) {
      // red color
      debugger;
    }
  };

  const trace = (...args) => {
    if (TRACE_ENABLED) {
      // blue color , no break
      console.log('%c imgurgeeks-ext ', 'color: white; font-weight: bold; background-color: blue', ...args);
    }
  };

  const HARD_MAX_PAGES = TEST_LIMIT_DATA ? 2 : 10;
  const MAX_POST_PAGES_PER_LOOP = TEST_LIMIT_DATA ? 2 : 30;  // this is the number of "pages" when scrolling to load per loop before backing off
  const IMAGES_PER_PAGE_FETCH = 60;
  // total possible is HARD_MAX_PAGES*MAX_POST_PAGES_PER_LOOP*IMAGES_PER_PAGE_FETCH (18000)
  const REFRESH_PAGES = 4;

  const MIN_VIEW_THRESHOLD = 50;    // if a image has fewer than N views, then ignore it. (long tail problem)

  const TOP100_DISPLAY_SIZE_DEFAULT = 50;
  const TOP100_DISPLAY_SIZE_PRO = 100;// is_subscribed is true

  const TOP_N_SAVE_SIZE = 300;      // track MORE than we show for lots of reasons (position changes, quick refresh)

  // <// <editor-fold defaultstate="collapsed" desc="-- Message strings  --">
  // todo: localization matters. Should be moved to separate file to keep code readable.
  //  background.js would need to inject it, too. It would load a different language file based on ... language.
  //  Need to deal with how to messages like a template inline (e.g. 'Processing N of N')
  // Most messages are just using confirm() and alert() because we haven't implemented dom dialogs (yet)
  const MESSAGES = {
    DELETE_ALL_DATA_PROMPT:
        `ImgurGeeks Extension: 
                    
                      ====FULL REMOVING ALL DATA====\n\nOK to continue and delete?`,

    CLEAR_USER_DATA_PROMPT:
        `ImgurGeeks Extension: Removing data can take a while to download from scratch again.
                  
                      OK to continue and delete?`,

    CONFIRM_FETCH_RISK_PROMPT:
        `
IMGURGEEKS EXTENSION WARNING

Running it too often may result in imgur returning 500 errors or a temporary BAN.
After successfully running this the first time, you should switch and use the Refresh Action.

Click OK to accept this risk.`,

    WARN_DATA_OLD_UPGRADE_PROMPT:
        `ImgurGeeks Extension:
                            ====BETA RESETTING ALL DATA====
     
Embrace change. The older saved data is deprecated and so has been cleared. 
Such is the cost of progress.
      `,

    ENTER_ALT_USERNAME_PROMPT: `ImgurGeeks Extenion 
    Enter an alternate username:`,

    ERROR_NEED_FULL_FETCH:
        `This export requires you first run a "Get a FULL images" `,

    ERROR_OUT_OF_MEMORY: 'This is too much data for your browser to handle.',

    ERROR_SIGNIN_HTML:
        'You need to be signed into imgur to use this tool. <br> Log into imgur and try again.',

    IMGUR_FETCH_ERROR_MESSAGE_HTML:
        `<h3>Look Out</h3>
        <p>Imgur.com is returning errors or running very slowly. You may have made too many requests
        to it and it's wondering if you're not a bot.</p> 
        <p>Or, the site is experiencing heavy loads.</p>
        <p>Either way, you need to stop using this tool for a while and give the imgur server a break.</p>
        `,

    ERROR_NEED_SIGNIN_FULL_HTML:
        `<h5>You are <b>not</b> signed into imgur.com.</h5>
        <p>You must be signed into with a valid imgur.com account to use this tool.</p>
        <p>Log in and refresh this page.</p>`,

    SO_MUCH_DATA_HTML:
        ` <p>O.M.G. You have a <b>ton</b> of data.</p>
          <p>It's fine, we're going to continue, but slowing things down so imgur doesn't think you're a bot.</p>
          <p>You may want to put it in the background and let it finish. Just don't also use imgur while it's running.</p>
          Good luck!`,

    INTRO_TEXT_HTML:
        `<h5>ImgurGeeks Extension Statistics (Beta)<br>(NOT associated with imgur.com)</h5>
          <p>
          This tool will gather information about your posts/images and display a summary of interesting data.
          </p>
          <p>
          Collecting data issues a bunch of requests to imgur using your user account.
          </p>
          <p>
          <b>Running it too often</b> will result in imgur returning 500 errors (Imgur looks like it's down) or a <b>temporary
          BAN</b>. Do not use full loading more than once every few days. After the initial full load, use the lighter weight Refresh action
          that only updates more recent posts info.
          </p>
          `,

    WARNING_MESSAGE_TITLE_HTML: 'ImgurGeeks Extension Message',

    TOP100_HEADER_HTML:
        `Your Top ${TOP100_DISPLAY_SIZE_DEFAULT} images (by views)`,
    TOP100_PRO_SUFFIX_HTML: `<br>
      + BONUS ${TOP100_DISPLAY_SIZE_PRO-TOP100_DISPLAY_SIZE_DEFAULT} for being Imgur Emerald
      <img src="https://s.imgur.com/images/trophies/emerald.png" style="max-height: 1.5em" alt="imgur pro icon">`,

    TOP100_LIST_NOTES_HTML:
        `Notes:
          <ul>
          <li>Videos (.mp4) are static - gifs are animated. They may initally load slowly.</li>
          <li>Default Top images are just from Posts. Choose "Get data for ALL images" from Actions menu
          to include ALL images on your account.</li>
          <li>Data is saved on your machine in the cache. It will be here when you come back. </li>
          <li>Images with fewer than ${MIN_VIEW_THRESHOLD} views are ignored to conserve on memory</li>
          <li>No data is uploaded.</li>
          <li>Read more in the 
          <a href="https://groups.google.com/forum/#!topic/imgurgeeks/W9G3QmUfC-Y" 
            atl="read more about this feature on the forum" target="forum">forum</a></li>
          </ul>`,

    SUMMARY_HELP_HTML: `<a href="https://groups.google.com/forum/#!topic/imgurgeeks/f9RvZvmscQc"
        atl="read more about this feature on the forum" target="forum">forum</a></li>`,

    TOTAL_VIEWS_LABEL_HTML: `Total image views: `,
    POSTS_LABEL_HTML: `<br>Public stats from posts`,
    PAGE_TITLE: "ImgurGeeks extension - NOT ASSOCIATED WITH IMGUR",

    LOAD_DATA_POSTS_BUTTON: 'Load data ...',
    LOAD_DATA_POSTS_BUTTON_HELP: 'Start by loading data about your public posts',

    RELOAD_DATA_POSTS_BUTTON: 'Full load data again...',
    REFRESH_BUTTON: 'Quick refresh',
    EXPORT_BUTTON: 'Export data to csv',
    SLOW_FETCH_BUTTON: 'Get data for ALL images (slow)...',
    REMOVE_BUTTON: 'Remove...',
    ACTION_BUTTON: 'Actions',
    LOAD_PUBLIC_POST_OTHER_USER_BUTTON: 'Load data for other user...',
    LOAD_PUBLIC_POST_OTHER_USER_BUTTON_HELP: 'Emerald users can load public post data for other users',

    CANCELLING_PROGRESSBAR_HTML: '<i>CANCELLING...</i>',
    STARTING_PROGRESSBAR_HTML: '<b>Preparing</b>',
    PROCESSING_PROGRESSBAR_HTML: '<b>Processing</b>',
    CANCELLED_PROGRESSBAR_HTML: '<b>Cancelled</b>',
    BREATHER_PROGRESSBAR_HTML: 'Giving imgur a 10s breather. Continuing in a moment.',
    DONE_PROGRESSBAR_HTML: 'Done',
    ERROR_PROGRESSBAR_HTML: 'Imgur site returning <b>errors</b>',
    DATA_RESET_HTML: `<p>WARNING</p>
  <p>Your data had to be cleared because of a format change in the latest update.</p>
   <p>This suck but we're is still beta, so...</p>
   <p>Good news: this should not need to happen very often.</p>`,
  };

  const GREEN_ARROW_UP_SVG = `
      <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg" >
      <g class="layer">
        <title>Position rose</title>
        <path clip-rule="evenodd" d="m7.197,2.524a1.2,1.2 0 0 1 1.606,0c0.521,0.46 1.302,1.182 2.363,2.243a29.617,29.617 
        0 0 1 2.423,2.722c0.339,0.435 0.025,1.028 -0.526,1.028l-2.397,0l0,4.147c0,0.524 -0.306,0.982 
        -0.823,1.064c-0.417,0.066 -1.014,0.122 -1.843,0.122s-1.427,-0.056 -1.843,-0.122c-0.517,-0.082 
        -0.824,-0.54 -0.824,-1.064l0,-4.147l-2.396,0c-0.552,0 -0.865,-0.593 -0.527,-1.028c0.52,-0.669 
        1.32,-1.62 2.423,-2.722a52.996,52.996 0 0 1 2.364,-2.243z" 
        fill="#5fbf00" fill-rule="evenodd" id="svg_1" stroke="#ffffff" stroke-width="2"/>
      </g>
      </svg>`;

  const RED_ARROW_DOWN_SVG = `
      <svg width="16" height="16" xmlns="http://www.w3.org/2000/svg"  >
      <g class="layer">
      <title>Position dropped</title>
      <path clip-rule="evenodd" d="m8.803,13.476a1.2,1.2 0 0 1 -1.606,0a53.03,53.03
      0 0 1 -2.364,-2.243a29.613,29.613 0 0 1 -2.422,-2.722c-0.339,-0.435 -0.025,-1.028 
      0.526,-1.028l2.397,0l0,-4.147c0,-0.524 0.306,-0.982 0.823,-1.064a11.874,11.874 
      0 0 1 1.843,-0.122c0.829,0 1.427,0.056 1.843,0.122c0.517,0.082 0.824,0.54 
      0.824,1.064l0,4.147l2.396,0c0.552,0 0.865,0.593 0.527,1.028c-0.52,0.669 
      -1.32,1.62 -2.423,2.722a53.038,53.038 0 0 1 -2.364,2.243z" fill="#bc0000" 
      fill-rule="evenodd" id="svg_1" stroke="#ffffff" stroke-width="2"/>
      </g>
      </svg>
  `;

  const NEW_SVG = `
      <span role="img" aria-label="new" class="emojispan" > 🆕 </span>
`;
  // </editor-fold>

  // typescript will give us enums... until then.
  const UI_STATES = {
    UNKNOWN: 'UNKNOWN',
    NEEDS_LOGIN: 'NEEDS_LOGIN',
    NO_DATA: 'NO_DATA',
    LOADING: 'LOADING',
    HAS_DATA_IDLE: 'HAS_DATA_IDLE',
    REFRESHING: 'REFRESHING',
    CANCELLING: 'CANCELLING',
    MESSAGE_SHOW: 'MESSAGE_SHOW',
    MESSAGE_HIDE: 'MESSAGE_HIDE',
  };

  // scoped constants that need to stay consistent across code.
  const WEBCACHE_KEYS = {
    STORAGE_ROOT: 'imgurgeeks_ext',   // cache namespace (top level)

    DATAVERSION: 'DATAVERSION',   // forward compatibility - need to know version so if we have a breaking change
                                  // in the future, we can know to delete older data.
    POSTSDATA: 'POSTSDATA',       // saved per-user
    LASTMODPOSTS: 'LASTMODPOSTS',
    SUMMARYPOSTS: 'SUMMARYPOSTS', // cache of aggregate info from POSTSDATA

    TOPVIEWS: 'TOPVIEWS',               // top 200 by view count, sorted
    LASTMODTOPVIEWS: 'LASTMODTOPVIEWS',

    IMGVIEWS: 'IMGVIEWS',           // ALL image views! keep it small [hash:count,hash:count...]
    LASTMODIMAGES: 'LASTMODIMAGES',
    HASHTYPEBIN: 'HASHTYPEBIN',     // Hash's suffix type (e.g. .png .mp4)
    VIEWSSUM: 'VIEWSSUM',  // when we run through the images, we sum this up. It's a string.

    PRIORTOPVIEWS: 'PRIORTOPVIEWS',     // for showing differences. (UI not finished)
    PRIORTOPVIEWSLASTMOD: 'PRIORTOPVIEWSLASTMOD',

    PRIORSUMMARYPOSTS: 'PRIORSUMMARYPOSTS',
    // PRIORSUMMARYPOSTSLASTMOD: 'PRIORSUMMARYPOSTSLASTMOD', date is saved in the summary

    // adding new consts? Go check removePostDataFromCacheByUser(), etc.
  };
  const DATA_VERSION = 'v2.1';

  // used to cache values mostly. we scope it for clarity.
  // purist language nonsense, just allow a 'global' keyword scoped locally for sanity's sake.
  const GLOBALS = {
    /** @type Cache **/
    webcache: null,
    savedusername_cached: '',
    is_subscribed: false,       // username logged in is an imgur-pro users. they get bonus features.
    cancel_load: false,
    uistate: UI_STATES.UNKNOWN, // should only be changed by calling setUIState()
    settingscached: null,
    view_sums_bigint_cached: BigInt(0),
  };

  // this is kind of silly, but simplifies error checking, it's default value for a json parse for
  // fetch()ed data. In case the server returns blank data.
  const DEFAULT_REPONSE_SAFE = {
    data: {},
    success: false,
    status: -1,
  };

  // there are a few fetch() calls sprinkled around. want them all to use the same settings.
  // we use the ...spread-operator to mix in the referrer. Not sure about trusting the cache.
  const FETCH_OPTIONS = {
    'mode': 'cors',
    'credentials': 'include',
    'keepalive': true,
    // 'cache': 'force-cache', // this actually says USE the cache.
  };

  // is the string a bigint (or int)?
  function isNumeric(str) {
    try {
      // converting will throw if not numeric. js sucks huh?
      BigInt(str);  // Careful: a transpiler might optimize this line away
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   *
   * @param bigint_val {BigInt}
   * @return {string}
   */
  function bigIntToString(bigint_val) {
    // ignore linter "new Intl.NumberFormat().format(BigInt(12345678901234567890))" works fine.
    return new Intl.NumberFormat().format(bigint_val);
  }

  /**
   *
   * @param bigint_str {string}
   * @return {BigInt}
   */
  function stringToBigInt(bigint_str) {
    try {
      const stripped = bigint_str.replace(/\D/g, '');
      return BigInt(stripped);
    } catch (err) {
      logerr(err, err.stack);
      return BigInt(0);
    }
  }

  /**
   * Not going to pull in all of Moments just to do this.
   * @param newDate {Date}
   * @param oldDate {Date}
   * @return {string}
   */
  function dateDiffDisplay(newDate, oldDate) {
    const msecDiff = (newDate - oldDate);    // (new Date('1/2/2020') - new Date('1/1/2020')) => 86400000
    let secdiff = msecDiff / 1000;

    const days = Math.floor(secdiff / (60 * 60 * 24));
    secdiff -= (days * (60 * 60 * 24));

    const hrs = Math.floor(secdiff / (60 * 60));
    secdiff -= (days * (60 * 60));

    const mins = Math.floor((secdiff / 60) % 60);
    secdiff -= (days * (60 * 60));
    const secs = secdiff % 60;

    const parts = [];
    days ? parts.push(`${days}d`) : '';
    hrs ? parts.push(`${hrs}h`) : '';
    mins ? parts.push(`${mins}m`) : '';
    secs ? parts.push(`${secs}s`) : '';

    // if we have days, we don't need to show seconds.
    days ? parts.pop() : '';
    return parts.join(' ');
  }

  /**
   *
   * @param mimeType {string}
   * @return {string}
   */
  function mapMimeTypeToExt(mimeType) {
    return ({
      'image/gif': 'gif',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'video/mp4': 'gifv',
    }[mimeType]) || 'gif';
  }

  /**
   * @param datestring {string}
   * @return {string}
   */
  function getDateTimeAsFilenameStr(datestring = '') {
    // so annoying all this code just to have a number prepadded with zero.
    const padToTwoFn = number => number <= 99 ? `00${number}`.slice(-2) : number;

    // empty string means use current date/time
    datestring = (datestring !== '') ?
        new Date().toLocaleString() : new Date().toLocaleString();

    const now = new Date(datestring);
    const year = now.getFullYear();
    const mon = padToTwoFn(now.getMonth() + 1);
    const day = padToTwoFn(now.getDate());
    const hrs = padToTwoFn(now.getHours());
    const min = padToTwoFn(now.getMinutes());
    const sec = padToTwoFn(now.getSeconds());
    return `${year}-${mon}-${day}_${hrs}.${min}.${sec}`;
  }

  /**
   * async/await friendly sleep()
   *
   * @param ms Number
   * @return {Promise<void>}
   */
  function sleep(ms = 250) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * json.parse() has this annoying behavior where it throws if the data is an empty string.
   * avoid that by passing in a default value that can be used. Improves readability
   *
   * @param jsonstr {string}
   * @param default_val {*}
   * @param reviver_fn {function}
   * @return {*}
   */
  function jsonParseSafe(jsonstr = '', default_val, reviver_fn = null) {
    try {
      if (jsonstr === '') {
        return default_val;
      }
      if (reviver_fn) {
        return JSON.parse(jsonstr, reviver_fn);
      } else {
        return JSON.parse(jsonstr);
      }
    } catch (err) {
      logerr(err, `'${jsonstr}'`, err.stack);
      return default_val;
    }
  }

  /**
   * Encapsulates logic around doing an async fetch.
   * @param url {string}
   * @param referrer {string}
   * @param reviver_func {function}
   * @return {Promise<boolean|*>}
   */
  async function imgurFetch(url='', referrer='', reviver_func) {
    try {
      const response = await fetch(url, {'referrer': referrer, ...FETCH_OPTIONS}).catch((err) => {
        setMessageHtml(MESSAGES.IMGUR_FETCH_ERROR_MESSAGE_HTML);
        logerr('fetch error', err);
        throw err;
      });

      if (!response.ok) {
        logerr('fetch response error', response);
        return false;
      }

      const jsontext = await response.text();   // we want to filter json with a reviver, so don't use .json()
      const response_json = jsonParseSafe(jsontext, DEFAULT_REPONSE_SAFE, reviver_func);

      if (response_json.data.length === 0 || GLOBALS.cancel_load) {
        return false;
      }

      if (response_json.success === false) {    // imgur's not happy?
        logerr('fetch imgur server error', response_json);
        setMessageHtml(MESSAGES.IMGUR_FETCH_ERROR_MESSAGE_HTML);
        return false;
      }

      return response_json;
    } catch(err) {
      logerr(err,err.stack);
      return false;
    }
  }
  /**** Save/Get/Delete/Copy to webcache. We require the current username to handle users switching accounts ****/

  // <editor-fold defaultstate="collapsed" desc="-- WebCache ops  --">
  /**
   * @param username {string}
   * @param key {string}
   * @param value {string}
   * @return {Promise<boolean>}
   */
  async function putSavedStr(username, key, value) {
    try {
      await GLOBALS.webcache.put(`/imgurgeeks_extension/${username}.${key}.text`, new Response(`${value}`));
      return true;
    } catch (err) {
      logerr(err, err.stack);
    }
    return false;
  }

  /**
   * @param username {string}
   * @param key {string}
   * @param default_val {*}           default to return if not found
   * @return {Promise<string>}
   */
  async function getSavedStr(username, key, default_val = '') {
    try {
      const resp = await GLOBALS.webcache.match(`/imgurgeeks_extension/${username}.${key}.text`,
          {ignoreSearch: true, ignoreMethod: true, ignoreVary: true});
      return (resp ? await resp.text() : default_val);
    } catch (err) {
      logerr(err, err.stack);
      return '';
    }
  }

  /**
   * @param username {string}
   * @param key {string}
   * @return {Promise<boolean>}
   */
  async function deleteSavedData(username, key) {
    try {
      await GLOBALS.webcache.delete(`/imgurgeeks_extension/${username}.${key}.text`);
      return true;
    } catch (err) {
      logerr(err, err.stack);
    }
    return false;
  }

  /**
   * @param username {string}
   * @param oldkey {string}
   * @param newkey {string}
   * @return {Promise<boolean>}
   */
  async function copySavedStr(username, oldkey, newkey) {
    try {
      trace(`backing up '${oldkey}'=>'${newkey}' for user '${username}'`);
      const olddata = await getSavedStr(username, oldkey);
      if (olddata.length > 0) {
        await putSavedStr(username, newkey, olddata);
      }
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  // </editor-fold>

  /**
   * May be SUPER slow if we have to fetch it from imgur becasue of redirect to images page.
   * @return {Promise<string|*>}
   */
  async function getUsername() {
    // we've loaded it, so it's easy
    if (GLOBALS.savedusername_cached !== '') {
      return GLOBALS.savedusername_cached;
    }

    // check localStorage
    // Removing. Users switching profiles need to NOT cache this
    // const localstore_username = await localStorage.getItem('imgurgeeks_primary_username') || '';
    // if (localstore_username !== '') {
    //   GLOBALS.savedusername_cached = localstore_username;
    //   return GLOBALS.savedusername_cached;
    // }

    // get the username
    const url = 'https://api.imgur.com/3/account/me?client_id=546c25a59c58ad7';
    const referrer = 'https://imgur.com/upload?beta';

    const response = await fetch(url, {'referrer': referrer, ...FETCH_OPTIONS}).catch((err) => {
      logerr(err);
    });
    const data = await response.json();
    if (parseInt(data.status) !== 200 && data.success !== 'true') {
      logerr('getting username failed ', response);
      return '';
    }

    // todo: we could only enable features for pro users.
    // "is_subscribed": false,
    // "is_founders_club": false
    GLOBALS.is_subscribed =  data.data.is_subscribed === true;

    // await localStorage.setItem('imgurgeeks_primary_username', username);

    GLOBALS.savedusername_cached = data.data.url;
    return GLOBALS.savedusername_cached;
  }

  /**
   * assumes getUsername() has been called.
   * @return {number}
   */
  function getTopNSize() {
    return GLOBALS.is_subscribed ? TOP100_DISPLAY_SIZE_PRO : TOP100_DISPLAY_SIZE_DEFAULT;
  }

  /**
   * walk through the webcache looking at the keys (which are urls)
   * extract out the username form the url.
   *
   * @return {Promise<*[]>}
   */
  async function listAllSavedUsernames() {
    try {
      // see if we've created this object
      const key_objects = await GLOBALS.webcache.keys();
      const urls = key_objects.map((r) => r.url);

      const matches = [];
      for (let ii = 0; ii < urls.length; ii++) {
        const url = urls[ii];
        url.replace(/https:\/\/imgur.com\/imgurgeeks_extension\/([\w]+).POSTSDATA.text/, (m, p1) => {
          matches.push(p1);
        });
      }
      return matches;
    } catch (err) {
      logerr(err, err.stack);
    }
    return [];
  }

  /**
   * Backups are used to display changes to data in the UI (e.g. 100 more views)
   * The backup function is broken out and not part of saving because fetching *can*
   * be two parts so it's tough for lower level code to know when it should NOT backup to avoid
   * double writes.
   * TODO: One issue with this approach is user cancelling will overwrite data. Probably better to have
   *        a two-part commit phase (keep copy in temp location, then commit when done)
   *
   * @param username {string}
   * @return {Promise<void>}
   */
  async function backupSummaryPostsData(username) {
    await copySavedStr(username, WEBCACHE_KEYS.SUMMARYPOSTS, WEBCACHE_KEYS.PRIORSUMMARYPOSTS);
  }

  /**
   * see comment for backupPostsData
   * @param username {string}
   * @return {Promise<void>}
   */
  async function backupImagesData(username) {
    await copySavedStr(username, WEBCACHE_KEYS.TOPVIEWS, WEBCACHE_KEYS.PRIORTOPVIEWS);
    await copySavedStr(username, WEBCACHE_KEYS.LASTMODIMAGES, WEBCACHE_KEYS.PRIORTOPVIEWSLASTMOD);
  }

  /* class is really just to bottleneck calls to make debugging easier.
  * I've flipflopped between having a singleton class for all users and a class that instantiated.
  * */
  const ViewSumSinglton = {
    _sums: new Map(),  // username => BigInt

    init: async function (username) {
      try {
        if (this._sums.keys(username)) {
          // already inited fo this user, ignore
        }
        const value = stringToBigInt(await getSavedStr(username, WEBCACHE_KEYS.VIEWSSUM));
        this._sums.set(username, value);
      } catch (err) {
        logerr(err, err.stack);
        return false;
      }
    },

    save: async function (username = '') {
      if (username === '') {
        // loop over every value in map, save and remove from map
      } else if (!this._sums.has(username)) {
        logerr(`username not found in map '${username}'`, this._sums);
      } else {
        const value = this._sums.get(username);
        await putSavedStr(username, WEBCACHE_KEYS.VIEWSSUM, bigIntToString(value));
      }
    },

    /**
     * @param username {string}
     * @param value {int|BigInt}
     */
    addViews: function (username, value) {
      if (username === '') {
        logerr('username not set for ViewSumClass');
      }
      const sum = this._sums.get(username) + BigInt(value);
      trace(`added ${value} to '${username}' total: ${bigIntToString(sum)} `);
      this._sums.set(username, sum);
    },

    /**
     * For clarity/readability. When a hash is known and the value changes, we subtract the old value before adding
     *  the new value to to total.
     * @param username {string}
     * @param value {int|BigInt}
     */
    subViews: function (username, value) {
      this.addViews(username, -1 * value);
    },

    /**
     * @param username {string}
     * @return {string}
     */
    getViewsDisplay: async function (username) {
      await ViewSumSinglton.init(username);
      const value = this._sums.get(username);
      return bigIntToString(value);
    },
  };

  /**
   * persistent settings are passed into this code via localstorage. load and cache
   * @param force_reload {boolean}
   * @return {Promise<{}|null>}
   **/
  // async function LoadExtensionSettingsCached(force_reload = false) {
  //   if (GLOBALS.settingscached !== null && force_reload === false) {
  //     return GLOBALS.settingscached;
  //   }
  //   if (window.localStorage) {
  //     try {
  //       const result_str = await window.localStorage.getItem('imgurgeeks_save_settings') || '{}';
  //       GLOBALS.settingscached = jsonParseSafe(result_str, {debug_full_reset: false});
  //       return GLOBALS.settingscached;
  //     } catch (err) {
  //       log('LoadExtensionSettings', err, err.stack);
  //     }
  //   }
  //   return {};
  // }

  /**
   *
   * @param percent_complete {Number} 0.00 - 1.00
   * @param status_text {String}
   */
  function setprogressbar(percent_complete = 0.00, status_text = '') {
    try {
      document.getElementById('progressbarcontainer').classList.remove('invisible');
      document.getElementById('progressindicator').style.width = `${percent_complete * 100}%`;
      document.getElementById('progresstext').innerHTML = status_text;
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  function hideprogressbar() {
    document.getElementById('progressbarcontainer').classList.add('invisible');
  }

  /**
   * displays a message on the page.
   * @param str {string}
   */
  function setMessageHtml(str) {
    document.getElementById('message').innerHTML = str;
    setUIState(UI_STATES.MESSAGE_SHOW);
  }

  /**
   * Returns data for a given username
   * @param username {string}
   * @return {Promise<[]>}
   */
  async function getAllPostDataSavedByUser(username = '') {
    const EMPTY_DATA = [[], ''];
    try {
      if (username === '') {
        logerr('getUserData: username is empty, so no data');
        return EMPTY_DATA;
      }

      // We save the teams into the cache because it can get big. Putting into localStorage
      // would eat up too much of imgur's storage space.
      const data = await getSavedStr(username, WEBCACHE_KEYS.POSTSDATA);
      const date = await getSavedStr(username, WEBCACHE_KEYS.LASTMODPOSTS) || new Date().toLocaleString();

      if (data.length === 0) {
        return EMPTY_DATA;
      }

      const json_data = jsonParseSafe(data, []);

      return [json_data, date];
    } catch (err) {
      logerr(err, err.stack);
    }
    return EMPTY_DATA;
  }

  /**
   * Generic routine to walk all rows and sum() any numeric fields it finds. Bools' trues are converted to counts.
   * aggregate.
   * NOTE: the aggregates values have the potential to be REALLY big, so we're using BigInts.
   *
   * @param json_object {[]}
   * @return {{}}
   */
  function processSummaryData(json_object) {
    try {
      const summarydata = {};
      let totalcount = 0;

      for (let row of Object.values(json_object)) {
        for (let [key, value] of Object.entries(row)) {
          // support bools but converting to 0/1 then doing a count
          if (typeof value === 'boolean') {
            value = value ? 1 : 0;
          }
          if (!isNumeric(value)) {
            continue;
          }
          if (!summarydata.hasOwnProperty(key)) {
            // initialize
            summarydata[key] = BigInt(0);
          }
          summarydata[key] += BigInt(value);
        }
        totalcount++;
      }
      summarydata['totalcount'] = totalcount;

      // now, because each value is a BigInt it will choke JSON.stringify(), so convert
      // them all to strings    value = new Intl.NumberFormat().format(value)
      const summarydata_converted = {};
      for (let [key, value] of Object.entries(summarydata)) {
        summarydata_converted[key] = bigIntToString(value);
      }

      return summarydata_converted;
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   * run through the data, collect statistics and display.
   * NOTE: this was meant to be a "lazy" operation, if data sums not available, then
   *       generate and cache. However, if it's too slow, we'll need to tie into progress bar
   *       which means splitting out the load-from-cached value from recalc operations.
   * @param username {string}
   * @param force_refresh {boolean}
   * @return {Promise<[{}]>}
   */
  async function getSummaryData(username = '', force_refresh = false) {
    try {
      // try to load it from the webcache if we're not refreshing
      if (force_refresh === false) {
        const saved_session = await getSavedStr(username, WEBCACHE_KEYS.SUMMARYPOSTS);
        if (saved_session.length > 0) {
          return jsonParseSafe(saved_session, []);
        }
      }

      // not found? generate it and save it
      const [json_data, date] = await getAllPostDataSavedByUser(username);
      if (json_data.length === 0) {
        return null;
      }

      const summary_data = await processSummaryData(json_data);

      // it's handy to have ALL the information in a single struct, so include there non-aggregates
      summary_data['date'] = date;
      summary_data['username'] = username;

      await putSavedStr(username, WEBCACHE_KEYS.SUMMARYPOSTS, JSON.stringify(summary_data));
      return summary_data;
    } catch (err) {
      logerr(err, err.stack);
    }
    return [];
  }

  /**
   * We display per-user statistics. This call finds an existing element or creates is if needed.
   * @param username {string}
   * @return {HTMLElement}
   */
  function getUserDisplayElem(username) {
    const elem_id = `${username}_display`;
    let update_elem = document.getElementById(elem_id);
    if (update_elem) {
      return update_elem;
    }
    // otherwise create it.
    const new_elem = document.createElement('div');
    new_elem.id = elem_id;
    document.getElementById('summary_container').appendChild(new_elem);
    return new_elem;
  }

  /**
   * All classes here have a few basic things they are redoing. Moved here.
   * @abstract
   */
  class ImgurGeeksBaseClass {
    _isusernameprimary = true;
    _inited = false;
    _username = '';

    constructor() {
    }

    /**
     * @param username {string}
     * @return {Promise<void>}
     */
    async init(username) {
      try {
        if (this._inited) {
          return;
        }
        this._username = (username !== '') ? username : await getUsername();
        this._isusernameprimary = (await getUsername() === this._username);
        this._inited = true;
      } catch (err) {
        logerr(err, err.stack);
      }
    }

    async save() {
    }
  }

  /****
   * ImgExtMappingClass
   * The code below works and is fully debugged and is beautiful, but ultimately not required. We can tell dirty
   * lies to the browser and say every image is .gif and it will data sniff the image and realize what it actually is.
   * As a programmer, you KNOW how hard it is to delete something clever that works, so I'm just going to stub it
   * out and keep the old code around. Maybe some future feature will require the image suffix extension? Maybe
   ****/
  class ImgExtMappingClass extends ImgurGeeksBaseClass {
    // stubbed out version

    async init(username) {
    }

    // noinspection JSUnusedLocalSymbols
    hash_to_ext(hash) {
      return 'gif';
    }  // noinspection JSUnusedLocalSymbols
    addHash(hash, ext) {
    } // noinspection JSUnusedLocalSymbols
    async save(free_memory = false) {
    }
  }

  // <editor-fold defaultstate="collapsed" desc="-- old ImgExtMappingClass WORKS but not yet needed --">
  // class ImgExtMappingClass extends ImgurGeeksBaseClass {
  //   /***
  //    *  The extension is needed to display thumbnail. This is needed because the per-image fetch response
  //    *  breaks it out and not know the suffix makes building a <img src=url> thumbnail tricky.
  //    *
  //    *  We invert the data for bigdata reasons.
  //    *
  //    *  Since there are only 4 types of extensions. png, jpg, gif, mp4 and we just want to know which one
  //    *  an image has belongs to. A Bloom Filter would be great, but ... javascript.
  //    *
  //    *  So we create 4 "bins" and stick imgur-hashes into each one. Then we can test if a hash is in it.
  //    *
  //    *  Issue: js Array mean lots of small allocations overhead. We don't really use any
  //    *  features of an array other than testing if a imgur-hash is in it.
  //    *
  //    *  So, we're just going to save hashes in one of the 4 bins as ONE LONG STRING ',hash,hash,hash,...,hash,',
  //    *  then we search for (',hash,') to see if we find a match.
  //    *
  //    *  WHY? Linear scan of adjacent memory is STUPID FAST. Modern CPUs are optimized for it.
  //    *
  //    *  Postmortem:
  //    *  After coding all this up, I wonder if I couldn't just have stuck a .gif on the end of any
  //    *  image url and just let the browser data-sniff and get the correct mime-type? Browsers are pretty smart.
  //    */
  //
  //   _EMPTY_HASH_BINS = {
  //     jpg: ',',
  //     png: ',',
  //     gif: ',',
  //     mp4: ',',
  //   };
  //
  //   _img_type_hash_bins = this._EMPTY_HASH_BINS;
  //
  //   constructor(username) {
  //     super(username);
  //   }
  //
  //   /**
  //    * NOTICE this async. All the other calls on this class do not require it to make
  //    * code using this class more readable.
  //    * @return {Promise<void>}
  //    */
  //   async init() {
  //     try {
  //       await super.init();
  //
  //       const str_data = await getSavedStr(this._username, WEBCACHE_KEYS.HASHTYPEBIN);
  //       if (str_data !== '') {
  //         this._img_type_hash_bins = jsonParseSafe(str_data, this._img_type_hash_bins);
  //       }
  //     } catch (err) {
  //       logerr(err, err.stack);
  //       alert(MESSAGES.ERROR_OUT_OF_MEMORY);
  //     }
  //   }
  //
  //   /**
  //    * @param hash {string}
  //    * @return {string}
  //    */
  //   hash_to_ext(hash) {
  //     const hash_delim = `,${hash},`;
  //     for (const [key, value] of Object.entries(this._img_type_hash_bins)) {
  //       if (value.includes(hash_delim)) {
  //         return `${key}` || 'gif';
  //       }
  //     }
  //     logerr(`hash not found '${hash}'`);
  //     return 'gif';  // do something.
  //   }
  //
  //   /**
  //    * @param hash {string}
  //    * @param ext {string}
  //    */
  //   addHash(hash, ext) {
  //     if (hash === '' || ext === '') {
  //       logerr('bad parameter');
  //       return;
  //     }
  //
  //     // sanity check: convert '.jpg' => 'jpg' and '.png?1' => 'png' before bin
  //     if (ext.charAt(0) === '.') {
  //       ext = ext.substring(1, 4);
  //     }
  //
  //     if (!this._img_type_hash_bins.hasOwnProperty(ext)) {
  //       logerr(`missing ext '${ext}' in _img_type_hash_bins:`, this._img_type_hash_bins);
  //       return;
  //     }
  //
  //     // check if already in string before adding.
  //     if (this._img_type_hash_bins[ext].includes(`,${hash},`)) {
  //       return;
  //     }
  //
  //     // Just concat the two strings and insert trailing ','
  //     this._img_type_hash_bins[ext] += `${hash},`;
  //   }
  //
  //   /**
  //    *
  //    * @return {Promise<void>}
  //    */
  //   async save(backup = true, free_memory = false) {
  //     if (!this._inited) {
  //       return;
  //     }
  //     if (GLOBALS.cancel_load) {
  //       trace('not saving data because cancel');
  //     } else {
  //       await putSavedStr(this._username, WEBCACHE_KEYS.HASHTYPEBIN, JSON.stringify(this._img_type_hash_bins));
  //     }
  //
  //     // after saving, uninit to save memory?
  //     if (free_memory) {
  //       this._inited = false;
  //       this._img_type_hash_bins = this._EMPTY_HASH_BINS;
  //     }
  //   }
  //
  // }
  // </editor-fold>

  /**
   * Utility class used to contain/hide complexity around tracking the top N imgur-hashes by views
   * Originally was named Top100 and it's kind of stuck Easier on the eyes than TopN
   */
  class Top100TrackerClass extends ImgurGeeksBaseClass {
    _min_top_100_val = 0;
    /** @type {{Object}[]} **/
    _top_N_data = [];

    constructor() {
      super();
    }

    /**
     * NOTICE this async. All the other calls on this class do not require it to make
     * code using this class more readable.
     * @param username {string}
     * @return {Promise<void>}
     */
    async init(username) {
      try {
        await super.init(username);

        // load saved data
        const datastr = await getSavedStr(this._username, WEBCACHE_KEYS.TOPVIEWS);

        this._top_N_data = jsonParseSafe(datastr, []);
      } catch (err) {
        logerr(err, err.stack);
        alert(MESSAGES.ERROR_OUT_OF_MEMORY);
      }

    }

    _sortlist() {
      try {
        if (this._top_N_data.length === 0) {
          return;
        }
        // array is needed to preserve sequence order.

        // it's possible the same image is in two different posts, so we need to dedup.
        // js maps are btrees and pretty quick, so we use that to check for dups.
        const dedup_hashs = {};

        this._top_N_data = this._top_N_data.filter(function (row) {
          const hash = Object.keys(row)[0];
          if (hash in dedup_hashs) {
            return false;
          } else {
            dedup_hashs[hash] = 0;
            return true;
          }
        });

        // [{hash:value},{hash:value}]
        // straight forward reverse-sort-by-object-value
        this._top_N_data.sort((a, b) =>
            (Object.values(a)[0] <= Object.values(b)[0]) ? 1 : -1);

        // this._top_N_data may have gotten > 100, trim it down.
        this._top_N_data = this._top_N_data.slice(0, TOP_N_SAVE_SIZE);

        // update the min value to the last entry
        const lastEntryIsLowestValue = this._top_N_data[this._top_N_data.length - 1];
        this._min_top_100_val = Object.values(lastEntryIsLowestValue)[0];

        // if we were using a key/value db sort or wanted to sort 100k values we might each to
        // '000000000116_Gr0Fab5' and then sort. I tried that first, but we're only keep a few hundred so
        // the complexity isn't worth it. Gonna keep the code here in case I decide to sort ALL the hashes by views
        // pad it with zeros so string sorting works.
        // const viewstr = `00000000000000${views}`.substr(-12);  // gives us exactly 12 characters
        //
        // // the following appends the new value to the array.
        // this._top_N_data = [...this._top_N_data, `${viewstr}_${hash}`];
        // // we'll trim down the _top_N_data to only be 100 but later when we get enough
        //
        // // sort the top 100 list high to low
        // this._top_N_data.sort().reverse();
        //
        // // now we update our "min" threshold to be the last entry
        // // parseInt() will turn '000000000116_Gr0Fab5' into just an int of JUST the first part. stupid, I know
        // this._min_top_100_val = parseInt(this._top_N_data[this._top_N_data.length - 1]);
      } catch (err) {
        logerr(err, err.stack);
      }
    }

    /**
     * Top 100
     * @param entries {[Object]}
     */
    addHashes(entries) {
      try {
        if (this._isusernameprimary === false) {
          trace('Not saving TopN for non-primary users (yet)');
          return;
        }
        // sometimes we get an ordered array of [{key:value},...] other times we get {key:value, key:value}
        // normalize it so code below can assume [{key:value,key:value,...},{key:value,key:value,...},...]
        if (!Array.isArray(entries)) {
          entries = Array(entries);
        }
        for (let row of entries) {
          for (const [hash, views] of Object.entries(row)) {
            // fyi we know views is an int because of the LoadImagesDataClass._json_reviver_stats_images converted it.
            if (views === 0) {
              trace(`deleted or incorrect hash detected because view count is zero '${hash}'`);
              continue;
            }

            // not enough views to matter.
            if (views < MIN_VIEW_THRESHOLD) {
              trace(`ignoring '${hash}' views: ${views} < MIN_VIEW_THRESHOLD`);
              continue;
            }

            if (views < this._min_top_100_val) {  // updated after _sortlist()
              continue;
            }

            this._top_N_data.push({[hash]: views});
          }

          // time to garbage collect?
          if (this._top_N_data.length > (TOP_N_SAVE_SIZE * 2)) {
            // time to garbage collect
            this._sortlist();
          }
        }
      } catch (err) {
        logerr(err, err.stack);
      }
    }

    addHash(hash, views) {
      this.addHashes([{[hash]: views}]);
    }

    /**
     * We return as an array of objects to preserve ordering.
     * @return {{Object}[]}
     */
    getList() {
      if (!this._inited) {
        logerr('top10 not initialized');
        return [];
      }
      this._sortlist();   // addHash doesn't run every insert for performance reasons, run now just in case
      return this._top_N_data.slice(0, getTopNSize());
    }

    /**
     * super confusing to do syntax wise, bury it down here. probably some clever 1 liner to do the same thing.
     * @return {string[]}
     */
    getHashs() {
      if (!this._inited || this._top_N_data.length === 0) {
        return [];
      }
      this._sortlist();
      const result = [];

      for (const row of this._top_N_data) {
        for (const [hash, /*value*/] of Object.entries(row)) {
          result.push(hash);
        }
      }
      return result;
    }

    async save() {
      try {
        await super.save();

        if (!this._inited) {
          logerr('top10 not initialized');
          return false;
        }
        if (this._isusernameprimary === false && GLOBALS.is_subscribed === false) {
          trace('not saving TopN data for non-primary users for non-pro');
          return;
        }
        if (GLOBALS.cancel_load) {
          trace('not saving data because cancel');
          return;
        }

        this._sortlist();
        await putSavedStr(this._username, WEBCACHE_KEYS.TOPVIEWS, JSON.stringify(this._top_N_data));
        await putSavedStr(this._username, WEBCACHE_KEYS.LASTMODTOPVIEWS, new Date().toLocaleString());

        // if (this._isusernameprimary === false) {
        //   // after saving, uninit to save memory
        //   // for primary user, keep it around for UI.
        //   this._inited = false;
        //   this._min_top_100_val = 0;
        //   this._top_N_data = [];
        // }

      } catch (err) {
        logerr(err, err.stack);
      }
    }
  }

  /**
   * Two different types of fetching record the same data. Post fetching includes images and then the per-image view
   * fetch. This calls is used to collect/update the {hash:views} data.
   */
  class ImgViewsClass extends ImgurGeeksBaseClass {
    _img_views_map = {};

    constructor() {
      super();
    }

    /**
     * NOTICE this async. All the other calls on this class do not require it to make
     * code using this class more readable.
     *
     * @return {Promise<void>}
     */
    async init(username) {
      try {
        await super.init(username);

        // load saved data. This is a massive gc hit.
        const datastr = await getSavedStr(this._username, WEBCACHE_KEYS.IMGVIEWS);
        this._img_views_map = jsonParseSafe(datastr, {});
        await ViewSumSinglton.init(username);
      } catch (err) {
        logerr(err, err.stack);
        alert(MESSAGES.ERROR_OUT_OF_MEMORY);
      }
    }

    /**
     * Per image Views
     * @param entries {Object}
     * @return {int}   image hashes processed
     */
    addHashes(entries) {
      // sometimes we get an ordered array of [{key:value},...] other times we get {key:value, key:value}
      // normalize it so code below can assume [{key:value,key:value,...},{key:value,key:value,...},...]
      if (!Array.isArray(entries)) {
        entries = Array(entries);
      }
      let counter = 0;
      for (let row of entries) {
        for (const [hash, views] of Object.entries(row)) {
          if (views === 0) {
            trace(`deleted or incorrect hash detected because views zero? '${hash}'`);
            continue;
          }
          if (this._img_views_map.hasOwnProperty(hash)) {
            // update
            const currentval = Number(this._img_views_map[hash]);
            if (currentval === views) {
              trace(`skipping '${hash}' In table and views count unchanged.`);
              continue; // no update needed
            } else {
              // interesting
              if (views < currentval) {
                // can happen with "eventual consistency" on some big dbs
                trace(`Views DECREASED '${hash}' by ${views - currentval}`);
              }
              // we're about to update a value, remove the old value to the sum stays correct
              // update, remove old value from sum.
              ViewSumSinglton.subViews(this._username, currentval);
            }
          } else if (views < MIN_VIEW_THRESHOLD) {
            // view does NOT meet our minimum value to save it. Could count them and warn user to avoid confusion?
            trace(`ignoring '${hash}' views: ${views} < MIN_VIEW_THRESHOLD`);
            continue;
          }

          this._img_views_map[hash] = views;
          ViewSumSinglton.addViews(this._username, views);
          counter++;
        }
      }
      return counter;
    }

    // this call will be problematic for serializing data to background sandbox
    addHash(hash, views) {
      this.addHashes([{[hash]: views}]);
    }

    async save() {
      try {
        await super.save();

        // used for UI
        if (GLOBALS.cancel_load === false) {
          await putSavedStr(this._username, WEBCACHE_KEYS.IMGVIEWS, JSON.stringify(this._img_views_map));
          await putSavedStr(this._username, WEBCACHE_KEYS.LASTMODIMAGES, new Date().toLocaleString());
          await ViewSumSinglton.save(this._username);
        } else {
          trace('not saving data because cancel');
        }

        // after save free up memory!
        this._img_views_map = {};
        this._inited = false;
      } catch (err) {
        console.log(err, err.stack);
      }
    }
  }

  /**
   * Set the visual state of the UI, shows/hides/enable/disables html elements.
   * Not as nice as a reactive library, but much lighter weight.
   *
   * @param newState {UI_STATES}
   */
  function setUIState(newState = UI_STATES.UNKNOWN) {

    // readability helper f() only.
    // show/hide doesn't remove element and doesn't cause reflow.
    const show = (elemid = '') => {
      const elem = document.getElementById(elemid);
      if (elem === null) return;
      elem.disabled = false;
      elem.classList.remove('invisible', 'hidden');
    };
    const hide = (elemid) => {
      const elem = document.getElementById(elemid);
      if (elem === null) return;
      elem.classList.add('invisible');
    };
    const remove = (elemid) => {
      const elem = document.getElementById(elemid);
      if (elem === null) return;
      elem.classList.add('hidden');
    };
    const disable = (elemid) => {
      const elem = document.getElementById(elemid);
      if (elem === null) return;
      elem.diabled = true;
    };
    // const remove = (elemid) => {
    //   const elem = document.getElementById(elemid);
    //   if (elem === null) return;
    //   elem.classList.add('invisible');
    // };


    switch (newState) {
      case UI_STATES.UNKNOWN:
        remove('gather_post_stats_btn');
        remove('add_user_bonus_btn');
        remove('cancel_btn');
        hide('progressbarcontainer');
        hide('messagecontainer');
        break;

      case UI_STATES.NEEDS_LOGIN:
        remove('gather_post_stats_btn');
        remove('add_user_bonus_btn');
        remove('cancel_btn');
        hide('progressbarcontainer');
        show('messagecontainer');
        break;

      case UI_STATES.NO_DATA:
        show('gather_post_stats_btn');
        hide('progressbarcontainer');
        remove('cancel_btn');
        break;

      case UI_STATES.LOADING:
      case UI_STATES.REFRESHING: {
        GLOBALS.cancel_load = false;
        remove('gather_post_stats_btn');
        remove('add_user_bonus_btn');
        show('cancel_btn');
        show('progressbarcontainer');
        hide('messagecontainer');
        const progressbar_elem = document.getElementById('progressbarcontainer');
        progressbar_elem.scrollIntoView(false);
        progressbar_elem.focus();
      }
        break;

      case UI_STATES.HAS_DATA_IDLE:
        remove('gather_post_stats_btn');
        remove('cancel_btn');
        hide('progressbarcontainer');
        hide('messagecontainer');
        if (GLOBALS.is_subscribed) {
          show('add_user_bonus_btn');
        }
        break;

      case UI_STATES.CANCELLING:
        disable('cancel_btn');
        // special case. async/await cannot be cancelled (can you say "design flaw"?)
        // but we want the user to know we'll get there.
        document.getElementById('progresstext').innerHTML = MESSAGES.CANCELLING_PROGRESSBAR_HTML;
        hide('messagecontainer');
        break;

      case UI_STATES.MESSAGE_SHOW:
        show('messagecontainer');
        break;

      case UI_STATES.MESSAGE_HIDE:
        hide('messagecontainer');
        break;

      default:
        logerr(`Unknown state '${newState}'`);
        break;
    }
    // more for debugging than anything else, in theory it could be used used if we needed to know
    // from what state we are transitioning from.
    GLOBALS.uistate = newState;
  }

  /**
   * TODO: this is a very basic layout.
   * @param summarydata {}
   * @return {Promise<void>}
   */
  async function displaySummaryData(summarydata) {
    try {
      // todo: move these into messages localization
      const DISPLAYFIELDUIMAP = {
        // fieldname, displayname
        'date': 'Date gathered',
        // these are aggregates
        'totalcount': 'Total Posts',
        'viral': 'Most Viral',
        'views': 'Views',
        'points': 'Points',
        'favorite_count': 'Favorites',
        'ups': 'Upvotes',
        'downs': 'Downvotes',
        'comment_count': 'Comments',
        'datetime': 'Time Stamp',   // not actually a field, put here for typechecking cheat
      };
      const displayresult = [];

      if (summarydata === null || summarydata.length === 0) {
        return;
      }

      const username = summarydata['username'];

      // see if there's old data we can load to show delta
      const priordata = jsonParseSafe(await getSavedStr(username, WEBCACHE_KEYS.PRIORSUMMARYPOSTS), {});

      for (let [field, displayname] of Object.entries(DISPLAYFIELDUIMAP)) {
        try {
          const value = (summarydata.hasOwnProperty(field)) ? summarydata[field] : '';
          if (value !== '') {
            let delta_str = '';
            // do we have prior data for this field? per-field check is for data forward-compatibility
            if (priordata.hasOwnProperty(field)) {
              if (field === 'date') {
                // special case for date
                delta_str = dateDiffDisplay(new Date(value), new Date(priordata[field]));
              } else {
                // rest of the fields are numeric, but they are saved as strings '27,057,508'
                // convert to BigInts to do the math, then back
                trace(`${username} ${value} vs ${priordata[field]}`);
                const diff = stringToBigInt(value) - stringToBigInt(priordata[field]);
                delta_str = bigIntToString(diff);
              }

              if (delta_str !== '' && delta_str !== '0') {
                // prepend + if not already neg
                delta_str =  (!delta_str.startsWith('-')) ? `+${delta_str}` : delta_str;
                displayresult.push(`<b>${displayname}:</b> ${value} (${delta_str})`);
                continue;
              }
            }
            // no prior data
            displayresult.push(`<b>${displayname}:</b> ${value}`);
          }
        } catch (err) {
          // we catch inside loop to be tolerate of bad data
          logerr(err, err.stack);
        }
      }
      const displayhtml = displayresult.join('<br>');

      const html = `
      <!-- per-user Summary -->
      <div class="card border-success" style="width: 32rem;">
        <h5 class="card-header">${username} ${MESSAGES.POSTS_LABEL_HTML}</h5>
        <div class="card-body">

          <p class="card-text">${displayhtml}</p>
        </div>

        <div class="card-footer">
          <div class="dropdown">
            <button class="btn btn-success dropdown-toggle" type="button" id="dropdownMenuButton" 
                  data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
              ${MESSAGES.ACTION_BUTTON}
            </button>
            
            <div class="dropdown-menu btn-custom" aria-labelledby="dropdownMenuButton">

              <button class="btn btn-success dropdown-item-btn" data-username="${username}" data-cmd="export_post_summary">
                ${MESSAGES.EXPORT_BUTTON}
              </button>

              <button class="btn btn-warning dropdown-item-btn" data-username="${username}" data-cmd="load_posts">
                ${MESSAGES.RELOAD_DATA_POSTS_BUTTON}
              </button>

              <button class="btn btn-danger dropdown-item-btn" data-username="${username}" data-cmd="clear_post_summary">
                ${MESSAGES.REMOVE_BUTTON}
              </button>
              
            </div>
          </div> 
                  
          <button class="btn btn-success btn-custom" data-username="${username}" data-cmd="refresh_post_summary">
            ${MESSAGES.REFRESH_BUTTON}
          </button>
          <span class="summary-help">${MESSAGES.SUMMARY_HELP_HTML}</span>
        </div>
      </div>
      <br>
      <br>
      `;

      const parent_display_elem = getUserDisplayElem(username);
      parent_display_elem.innerHTML = html;
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  async function displayImgViewDetails() {
    try {
      const username = await getUsername();
      if (username === '') {
        return;
      }

      const top100 = new Top100TrackerClass();
      await top100.init(username);

      const imgExtMap = new ImgExtMappingClass();
      await imgExtMap.init(username);

      const rows = [];

      const top100list = await top100.getList();
      if (top100list.length === 0) {
        return;
      }

      // for showing position change.
      const invert_priortop100 = {};

      {  // scoping to unload memory for top100
        const prior_top100list = jsonParseSafe(await getSavedStr(username, WEBCACHE_KEYS.PRIORTOPVIEWS), []);
        for (const [ii, element] of Object.entries(prior_top100list)) {
          // noinspection JSCheckFunctionSignatures  (for elements)
          for (const [key] of Object.entries(element)) {   //
            invert_priortop100[key] = parseInt(ii);   // prior position
          }
        }
      }

      for (const elem of top100list) {
        /** @type ['',''] **/
        const [hash, views] = Object.entries(elem)[0];

        let ext = imgExtMap.hash_to_ext(hash);

        // we could map the '.mp4' to '.gifv'
        if (ext === 'mp4') {
          ext = 'gif';
        }

        const views_str = new Intl.NumberFormat().format(parseInt(views));

        let position_change = '';
        {
          if (!invert_priortop100.hasOwnProperty(hash)) {
            // new entry
            position_change = `${NEW_SVG}`;
          } else {
            const old_pos = invert_priortop100[hash];
            if (rows.length === old_pos) {
              // no change
            } else if (rows.length > old_pos) {
              position_change = `${RED_ARROW_DOWN_SVG} ${old_pos + 1}`;
            } else {
              position_change = `${GREEN_ARROW_UP_SVG} ${old_pos + 1}`;
            }
          }
        }

        // noinspection HtmlDeprecatedAttribute - I know tables are "old" shutup
        rows.push(`
      <tr class="top-50-tr">
        <th class="top-50-td" align="right" scope="row">${rows.length + 1}</th>
        <td class="top-50-td" align="center"><img src="https://i.imgur.com/${hash}.${ext}" class="rounded top-50-img-thumbnail imgpreview" alt="thumbnail"></td>
        <td class="top-50-td" align="right">${views_str}</td>
        <td class="top-50-td"></td>
        <td class="top-50-td"><a href="https://imgur.com/${hash}" target="_imgurview" data-toggle="tooltip" title="See image on imgur">${hash}</a></td>
        <td class="top-50-td">${position_change}</td>
      </tr>
`);

        // we keep track of the top 100, but we only so the top 50. This is required refresh action to work.
        if (rows.length === getTopNSize()) {
          break;
        }
      }

      const tablecontents = rows.join("\r\n");

      const views_count_str = await ViewSumSinglton.getViewsDisplay(username);

      // we have a dynamic value that has to be late binded. Do it now with a simple replace.
      const top_n_header_suffix = GLOBALS.is_subscribed ? MESSAGES.TOP100_PRO_SUFFIX_HTML : '';

      // noinspection HtmlDeprecatedAttribute - I know tables are "old" shutup
      document.getElementById('details_container').innerHTML = `
      <!-- Top 100 -->
      <div class="card border-success card-top-100">
        <h5 class="card-header">${MESSAGES.TOP100_HEADER_HTML}${top_n_header_suffix}</h5>
        <div class="card-body">

          <p class="card-text">
              <table class="table table-hover table-secondary">
              <tbody>
              ${tablecontents}
              
              <tr>
              <td align="right" colspan="2">
              <b>${MESSAGES.TOTAL_VIEWS_LABEL_HTML}</b> 
              </td>
              <td align="right">${views_count_str}</td>
              <td colspan="3"></td>
              </tr>
              
              <tr><td colspan="6">
              ${MESSAGES.TOP100_LIST_NOTES_HTML}
              </td></tr>
              </tbody>
             </table>
          </p>
        </div>

        <div class="card-footer">
          <div class="dropdown">
           <button class="btn btn-success dropdown-toggle" type="button" id="dropdownMenuButton" 
                  data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
              ${MESSAGES.ACTION_BUTTON}
            </button>
            <div class="dropdown-menu btn-custom" aria-labelledby="dropdownMenuButton">
              <button class="btn btn-success dropdown-item-btn" data-username="" data-cmd="export_image_summary">
                ${MESSAGES.EXPORT_BUTTON}</button>
              <button class="btn btn-warning dropdown-item-btn" data-username="" data-cmd="load_all_images">${MESSAGES.SLOW_FETCH_BUTTON}</button>
              <button class="btn btn-danger dropdown-item-btn" data-username="" data-cmd="clear_image_summary">${MESSAGES.REMOVE_BUTTON}</button>
            </div> 
          </div>
          
          <button class="btn btn-success btn-custom" data-username="" data-cmd="refresh_image_summary">${MESSAGES.REFRESH_BUTTON}</button>
        </div>
        
    </div>
    `;
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   * Load summary data for a given user and render the html for just them.
   * @param username {string}
   * @param force_refresh {boolean}
   * @return {Promise<void>}
   */
  async function updatePostsUI(username, force_refresh = false) {
    try {
      if (username === '') {
        logerr('username parameter is empty. failing');
        return;
      }

      const summarydata = await getSummaryData(username, force_refresh);
      await displaySummaryData(summarydata);

      setUIState(UI_STATES.HAS_DATA_IDLE);
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   * Set up the html for our page.
   * @return {Promise<void>}
   */
  async function setUpPage() {
    try {
      // we may be run multiple times as the background script tries to inject this script as early as possible.
      // so we use the existence of this element as a test to see if we injected into this page.
      if (document.getElementById('imgurgeekscontainer') === null) {
        // if this element exists, then we've already injected successfully.
        const HTML = `
<div class="container imgurgeekscontainer jumbotron bg-dark" id="imgurgeekscontainer">
  <div id="messagecontainer" class="message-container invisible">
    <div class="alert alert-dismissible alert-warning">
      <button type="button" class="close" data-cmd="close_alert" id="close_alert">&times;</button>
      <h4 class="alert-heading">
        <img src="https://i.imgur.com/XORy3fO.png" class="float-left rounded logo" style="zoom:0.5" alt="logo">
        ${MESSAGES.WARNING_MESSAGE_TITLE_HTML}
      </h4>
      <p class="mb-0" id="message"></p>
    </div>
  </div>

  <div class="clearfix intro-text">
    <img src="https://i.imgur.com/XORy3fO.png" class="float-left mr-4 rounded logo"
         alt="logo">
    ${MESSAGES.INTRO_TEXT_HTML}
  </div>
  <br>

  <div class="progress-bar-container invisible" id="progressbarcontainer">
    <div class="progress-bar progress-bar-tweaks progress-bar-striped" role="progressbar">
      <div id="progressindicator" class="progress-indicator-tweaks"></div>
    </div>
    <div><span id="progresstext" class="progress-text"></span></div>
  </div>
  <br>
  <div class="main-buttons" id="mainpostbuttons">
    <button id="gather_post_stats_btn" class="btn btn-success" data-username="" data-cmd="load_posts" 
      title="${MESSAGES.LOAD_DATA_POSTS_BUTTON_HELP}">
      ${MESSAGES.LOAD_DATA_POSTS_BUTTON}
    </button>
    
    <button id="add_user_bonus_btn" class="btn btn-success invisible" data-username="" data-cmd="load_posts_bonus"
      title="${MESSAGES.LOAD_PUBLIC_POST_OTHER_USER_BUTTON_HELP}">
      <img src="https://s.imgur.com/images/trophies/emerald.png" style="max-height: 1.5em" alt="logo"> ${MESSAGES.LOAD_PUBLIC_POST_OTHER_USER_BUTTON}
    </button>
    
    <button id="cancel_btn" class="btn btn-success invisible" data-username="" data-cmd="cancel_load">cancel
    </button>
    <br><br>
  </div>

  <div id="summary_container" class="summary-constainer"></div>
  
  <div id="details_container" class="details-container"></div>
  
  <div id="pro_imgur_container" class="pro-imgur-container"></div>
  
</div>
`;

        // disable existing stylesheets so as to not conflict with the new ones.
        for (let ii = 0; ii < document.styleSheets.length; ii++) {
          document.styleSheets[ii].disabled = true;
        }

        document.title = MESSAGES.PAGE_TITLE;
        document.body.innerHTML = HTML;

        // let the dom update and add hooks via timeout callback
        window.setTimeout(() => {
          try {
            document.body.style.display = 'block'; // the css loading hide the body

            document.getElementById('imgurgeekscontainer').addEventListener('click', async (evt) => {
              const target = evt.target;
              if (!['button', 'submit'].includes(target.type)) {
                return;
              }
              const cmd = target.dataset.cmd || '';
              if (cmd === '') {
                return;
              }

              let username = target.dataset.username || '';
              if (username === '') {
                username = await getUsername();
              }
              const shiftKeyDown = evt.shiftKey;

              try {
                switch (cmd) {
                  case 'load_posts': {
                    setUIState(UI_STATES.LOADING);
                    await backupSummaryPostsData(username);
                    await backupImagesData(username);
                    await LoadPostDataClass.fetchDataFromImgurStatic(username);
                    await updatePostsUI(username, true);
                    await displayImgViewDetails();
                    setUIState(UI_STATES.HAS_DATA_IDLE);
                  }
                    break;

                  case 'load_posts_bonus': {
                    // todo: refactor to remove dup code here.
                    if (!(TESTERS_GET_EXTRA_FEATURES || GLOBALS.is_subscribed)) {   // testers just get to do this.
                        return;
                    }
                    const altusername = prompt(MESSAGES.ENTER_ALT_USERNAME_PROMPT);
                    if (altusername && altusername !== '') {
                      // simple sanitize.
                      username = altusername.replace(/[^A-Za-z0-9]/g,"");
                      if (username === '') {
                        return;
                      }
                    } else {
                      return; // bail if they cancelled
                    }
                    setUIState(UI_STATES.LOADING);
                    await backupSummaryPostsData(username);
                    await backupImagesData(username);
                    await LoadPostDataClass.fetchDataFromImgurStatic(username);
                    await updatePostsUI(username, true);
                    await displayImgViewDetails();
                    setUIState(UI_STATES.HAS_DATA_IDLE);
                  }
                    break;

                  case 'load_all_images': {
                    setUIState(UI_STATES.LOADING);
                    await backupImagesData(username);
                    await LoadImagesDataClass.fetchDataFromImgurStatic(username);
                    await displayImgViewDetails();
                    setUIState(UI_STATES.HAS_DATA_IDLE);
                  }
                    break;

                  case 'cancel_load':
                    setUIState(UI_STATES.CANCELLING);
                    GLOBALS.cancel_load = true;
                    break;

                  case 'refresh_post_summary': {
                    setUIState(UI_STATES.REFRESHING);

                    await backupSummaryPostsData(username);
                    await backupImagesData(username);

                    const success = await LoadPostDataClass.fetchDataFromImgurStatic(username, 2, true);
                    if (GLOBALS.cancel_load || success===false) {
                      setprogressbar(1.0, MESSAGES.CANCELLED_PROGRESSBAR_HTML);
                    } else {
                      setprogressbar(0.5, MESSAGES.PROCESSING_PROGRESSBAR_HTML);
                      // for a refresh, we want to recheck the TopN images and a couple of pages of news
                      await LoadImagesDataClass.fetchDataFromImgurStatic(username, 2, true);
                      setprogressbar(1.0, MESSAGES.DONE_PROGRESSBAR_HTML);
                    }
                    await sleep(1000);
                    setUIState(UI_STATES.HAS_DATA_IDLE);
                    await displayImgViewDetails();
                    await updatePostsUI(username, true);
                  }
                    break;

                  case 'refresh_image_summary': {
                    const progressbar_elem = document.getElementById('progressbarcontainer');
                    progressbar_elem.scrollIntoView(false);
                    progressbar_elem.focus();
                    setUIState(UI_STATES.REFRESHING);

                    await backupSummaryPostsData(username);
                    await backupImagesData(username);

                    await LoadImagesDataClass.fetchDataFromImgurStatic(username, 3, true);

                    setprogressbar(1.0, MESSAGES.DONE_PROGRESSBAR_HTML);
                    await sleep(1000);

                    setUIState(UI_STATES.HAS_DATA_IDLE);
                    await displayImgViewDetails();
                    await updatePostsUI(username, true);
                  }
                    break;

                  case 'clear_image_summary':
                    if (shiftKeyDown) {
                      if (confirm(MESSAGES.DELETE_ALL_DATA_PROMPT)) {
                        await forceClearEverything();
                        // refresh the page.
                        window.location.reload();
                      }
                      break;
                    }

                    if (confirm(MESSAGES.CLEAR_USER_DATA_PROMPT)) {

                      // remove ui
                      document.getElementById('details_container').innerHTML = '';

                      await removeImageDataFromCacheByUser(username);
                    }
                    setUIState(UI_STATES.NO_DATA);
                    break;
                  case 'clear_post_summary': {
                    if (shiftKeyDown) {
                      if (confirm(MESSAGES.DELETE_ALL_DATA_PROMPT)) {
                        await forceClearEverything();
                        // refresh the page.
                        window.location.reload();
                      }
                      break;
                    }

                    if (confirm(MESSAGES.CLEAR_USER_DATA_PROMPT)) {
                      // remove the html element
                      const elem_id = `${username}_display`;
                      const elem = document.getElementById(elem_id);
                      if (elem) {
                        elem.parentElement.removeChild(elem);
                      }

                      await removeAllDataFromCacheByUser(username);
                      window.location.reload(); // easiest to redraw everything
                    }
                    setUIState(UI_STATES.NO_DATA);
                  }
                    break;

                  case 'export_post_summary':
                    await ExportPostData.exportDataStatic(username);
                    break;

                  case 'close_alert':
                    setUIState(UI_STATES.MESSAGE_HIDE);
                    break;

                  case 'export_image_summary':
                    await ExportImageViews.exportDataStatic(username);
                    break;

                  default:
                    logerr(`unknown cmd '${cmd}' event:`, evt);
                }

                evt.preventDefault();
                // noinspection JSUnresolvedVariable
                if (typeof evt.target.blur === "function") {
                  // noinspection JSUnresolvedFunction
                  evt.target.blur();
                }

              } catch (err) {
                logerr(err, err.stack);
              }
            });

          } catch (err) {
            logerr(err, err.stack);
          }
        });
      }
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  // <editor-fold defaultstate="collapsed" desc="-- data exporters  --">
  /**
   * Feels like I'm overusing OOP, but it's not like we have generics.
   * Maybe we should move this into RecordImgViewsClass, etc?
   * @abstract
   */
  class _ExporterBase {
    /**
     * subclasses must return data. It's called by exportDataStatic
     * This function is STATIC. It does not need a new() or init(). It's done to avoid parsing json.
     * @param username
     * @return {Promise<{filename: string, cvsdata: string}>}
     * @private
     * @static
     */
    static async _getDataForExportStatic(username) {
      return {filename: '', cvsdata: ''};
    }

    /**
     * This function is STATIC. It does not need a new()
     * @param username {string}
     * @return {Promise<void>}
     * @static
     * @public
     */
    static async exportDataStatic(username) {
      try {
        const {filename, cvsdata} = await this._getDataForExportStatic(username);
        /** Example row
         {
        "cBCYMHO": 123k3,
      },
         */

        if (filename === '' || cvsdata === '') {
          alert(MESSAGES.ERROR_NEED_FULL_FETCH);
          return;
        }

        // standard save as behavior.
        const blob = new Blob([cvsdata], {type: 'text/csv;charset=utf-8,\uFEFF'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        logerr(err, err.stack);
      }
    }
  }

  /**
   * call like 'async ExportPostData.exportDataStatic(username)'
   */
  class ExportPostData extends _ExporterBase {

    /**
     * This function is STATIC. It does not need a new()
     * @param username
     * @return {Promise<{filename: string, cvsdata: string}>}
     * @private
     * @static
     */
    static async _getDataForExportStatic(username) {
      try {
        // unfortunately, we have to pass through json to format.
        const [data_json, date] = await getAllPostDataSavedByUser(username);

        if (data_json.length === 0) {
          return {filename: '', cvsdata: ''};
        }

        // include the date/time it was captured in the default filename.
        const filename_datestr = getDateTimeAsFilenameStr(date);
        const filename = `${username}-POSTS-${filename_datestr}.csv`;

        // column names will be the first row exported.
        // we basically use the fist entry's **key names** as column names.
        const header = Object.keys(data_json[0]);

        // it's really confusing to not have the data sorted by date.
        // convert the array of json objects to an array-of-array
        // search for "in_most_viral"->"viral" in this code.
        const array_of_arrays = data_json.map(el=>Object.values(el));
        // warning Moving the date column to the 1st position
        const descending = array_of_arrays.sort((a, b) =>
            (new Date(a[9]) - new Date(b[9])) ? 1: -1);

        // We use tabs instead of commas to avoid having to escape them
        let cvsdata = descending.map(row => row.join(`\t`));
        cvsdata.unshift(header.join(`\t`)); // prepend the header

        cvsdata = cvsdata.join(`\r\n`);

        return {filename, cvsdata};
      } catch (err) {
        logerr(err, err.stack);
        return {filename: '', cvsdata: ''};
      }
    }
  }

  /**
   * call like 'async ExportImageViews.exportDataStatic(username)'
   */
  class ExportImageViews extends _ExporterBase {
    /**
     * This function is STATIC. It does not need a new() or init(). It's done to avoid parsing json.
     * @param username
     * @return {Promise<{filename: string, cvsdata: string}>}
     * @private
     * @static
     */
    static async _getDataForExportStatic(username) {
      try {
        // include the date/time it was captured in the default filename.
        const datastr = await getSavedStr(username, WEBCACHE_KEYS.IMGVIEWS);

        const datestr = await getSavedStr(username, WEBCACHE_KEYS.LASTMODIMAGES);
        const filename_datestr = getDateTimeAsFilenameStr(datestr);
        const filename = `${username}-IMAGES-${filename_datestr}.csv`;

        // the simple json format is VERY close to what we want, we're not going to parse and recombine, we're
        // just going to replace delimiters in place.
        // Replace the '{"key":value,"key":value}' => "key"\tvalue\r\n"key"\t\value\r\rn
        let cvsdata = datastr.replace(/:/g, "\t").replace(/,/g, "\r\n").replace(/[{}]/g, '');
        cvsdata = "Image\tViews\r\n" + cvsdata;

        return {filename, cvsdata};
      } catch (err) {
        logerr(err, err.stack);
        return {filename: '', cvsdata: ''};
      }
    }
  }

  // </editor-fold>

  /**
   * I'm not a big fan of unnecessary OOP in small projects, but the code to fetch Post data vs Image data
   * is annoyingly similar. 80% is the same code/logic with some small details changed around the type of data
   * being fetched.
   *
   * My solution is classes because it fits and we don't have generics.
   *
   * _AbstractLoadUserDataFromImgur should never be instantiated. It controls the overall logic of fetching and
   * processing data and updating the UI.
   *
   * LoadPostDataClass.fetchDataFromImgurStatic() and
   * LoadImagesDataClass.fetchDataFromImgurStatic() are static functions that should be called.
   *
   * @abstract
   */
  class _AbstractLoadUserDataFromImgur extends ImgurGeeksBaseClass {

    /**
     * main logic for fetching, subclasses must override the _xxxx() functions above.
     * To simplify code in other places, it does everything needed do a fetch.
     * @param username {string}
     * @param maxpostpages {int}
     * @param merge {boolean}
     * @return {Promise<void>}
     */
    static async fetchDataFromImgurStatic(username = '', maxpostpages = MAX_POST_PAGES_PER_LOOP, merge = false) {
      try {
        if (!merge) {
          if (!window.confirm(MESSAGES.CONFIRM_FETCH_RISK_PROMPT)) {
            return;
          }
        }

        if (username === '') {   // we likely got redirected to a signin page, just let them know
          setMessageHtml(MESSAGES.ERROR_NEED_SIGNIN_FULL_HTML);
          return;
        }

        // UI
        setUIState(UI_STATES.LOADING);
        setprogressbar(0.01, MESSAGES.STARTING_PROGRESSBAR_HTML);

        // create an instance of this child class and drive the process of fetching, processing and updating ui
        const instance = new this(maxpostpages, merge);

        // ok to call twice.
        await instance._init(username);

        // retries is really "outer loops"
        const retries = merge ? 1 : HARD_MAX_PAGES; // 10 retries better be enough

        let hit_data_end = false;
        let sleep_delay = 500;

        for (let jj = 0; jj < retries && hit_data_end === false; jj++) {
          // ok. some power users literally have more than 50 pages of posts... how to deal with it?
          // we don't want the progress bar to be massive for average users, and if it's taking THAT
          // long, we really should pause / back off or the user will get banned.
          for (let ii = 0; ii < maxpostpages; ii++) {
            const total_index = ii + (jj * maxpostpages);  // each outer loop means we we did another maxpostpages
            const success = await instance._fetchStep(total_index);

            if (GLOBALS.cancel_load) {
              // user clicked cancel button
              setprogressbar(1.0, MESSAGES.CANCELLED_PROGRESSBAR_HTML);
              await sleep(1000);
              setUIState(UI_STATES.NO_DATA);
              return;
            }

            if (success === false) {
              setprogressbar(1.0, MESSAGES.DONE_PROGRESSBAR_HTML);
              await sleep(2000);
              hideprogressbar();
              hit_data_end = true;
              break;
            }

            if (instance._total_count > 0) {
              // TODO: localization needs template support.
              setprogressbar((instance._running_count / instance._total_count),
                  `Loading (${instance._running_count} of ${instance._total_count})...`);
            } else {
              setprogressbar((ii / maxpostpages), `Loading (${instance._running_count})...`);
            }

            // if we fetch too fast, imgur will probably get upset. play nice and delay
            await sleep(sleep_delay);
          }

          // we expect the merge action to not "complete" (hit the end of data), it's only doing the first few pages.
          if (hit_data_end === false && merge === false) {
            // let the user know it might get rough (memory/performance wise)
            setMessageHtml(MESSAGES.SO_MUCH_DATA_HTML);
            setprogressbar(0, MESSAGES.BREATHER_PROGRESSBAR_HTML);
            sleep_delay = Math.min(sleep_delay * 2, 2000);  // double slowdown each round, max 2s per request.
            await sleep(1000 * 10);
          }
        }
        await instance._saveData();
        if (!merge) {
          // merging is fast and might include doing multiple fast checks, so, don't show done.
          setprogressbar(1.0, MESSAGES.DONE);
          await sleep(1000 * 2);
        }

      } catch (err) {
        logerr(err, err.stack);
      }
    }

    _maxpostpages = 0;
    _merge = false;
    _running_count = 0;
    _total_count = 0;
    _isusernameprimary = false;
    /** @type Top100TrackerClass **/
    _top100 = null;
    /** @type ImgExtMappingClass **/
    _img_ext_map = null;
    /** @type ImgViewsClass **/
    _img_views = null;

    constructor(maxpostpages = MAX_POST_PAGES_PER_LOOP, merge = false) {
      super();
      this._maxpostpages = maxpostpages;
      this._merge = merge;
      this._running_count = 0;
      this._total_count = 0;   // image fetching knows how many images there are in advance.
      // this._isusernameprimary  // needs async, so in _init()
    }

    /**
     * basically an async/await constructor ... also see STATIC f() below!
     * @param username {string}
     * @return {Promise<void>}
     * @protected
     */
    async _init(username = '') {
      try {
        await super.init(username);

        this._isusernameprimary = (await getUsername() === username);

        this._top100 = new Top100TrackerClass();
        this._img_ext_map = new ImgExtMappingClass();
        this._img_views = new ImgViewsClass();

        // username may NOT be active user.
        // we about to load everything into memory. This is gonna suck.
        await this._top100.init(username);
        await this._img_ext_map.init(username);
        await this._img_views.init(username);
      } catch (err) {
        // pattern but each contained class' init() probably handing it
        logerr(err, err.stack);
        alert(MESSAGES.ERROR_OUT_OF_MEMORY);
      }
    }

    /**
     * Each loop calls this to fetch a block of data
     * @param ii {int}
     * @return {Promise<boolean>}
     * @protected
     */
    async _fetchStep(ii) {
      return false;
    }

    /**
     * final saving fo data into webcache
     * @return {Promise<void>}
     * @protected
     */
    async _saveData() {
      if (GLOBALS.cancel_load) {
        trace('not saving data because cancel');
        return;
      }

      await this._img_ext_map.save();
      await this._img_views.save();
      await this._top100.save();
    }

  }

  class LoadPostDataClass extends _AbstractLoadUserDataFromImgur {
    _allreplies = [];

    constructor(maxpostpages = MAX_POST_PAGES_PER_LOOP, merge = false) {
      super(maxpostpages, merge);
    }

    /**
     * @param username {string}
     * @return {Promise<void>}
     * @protected
     */
    async _init(username = '') {
      await super._init(username);
    }

    static _json_reviver_posts(key, value) {
      // keys we want.
      if (['', 'data', 'id', 'title', 'score', 'views',
        'in_most_viral', 'ups', 'downs', 'points', 'score',
        'datetime', 'comment_count', 'favorite_count',
        'is_album', 'images'].includes(key)) {
        // trace(`json_reviver_post_data_fn keep '${key}' `, value);
        if (value === null) {
          return '';  // return empty string
        }
        return value;
      }
      // this is required to keep nested object data.
      // for arrays, this will be a number, so let's check that.
      if (typeof value === 'object' && isNaN(key) === false) {
        // trace(`json_reviver_post_data_fn keep object '${key}' `, value);
        return value;
      }
      // trace(`json_reviver_post_data_fn reject '${key}'`);
      return undefined;
    }


    /**
     * posts
     * @return {Promise<void>}
     * @protected
     */
    _process_response_json(response_json) {
      try {
        // walk through and grab all the images
        for (const row of response_json) {
          try {
            // look at the images on the FP posts and use for updating/creating the Top100
            if (this._isusernameprimary) {
              // noinspection JSUnresolvedVariable
              if (!row.is_album) {
                const hash = row.id;
                const ext = mapMimeTypeToExt(row.type);
                // const {hash, ext} = extractInfoFromUrl(row.link);
                // save the data
                this._top100.addHash(hash, row.views);
                this._img_views.addHash(hash, row.views);
                this._img_ext_map.addHash(hash, ext);
              } else {
                for (const image of row.images) {
                  const hash = image.id;
                  const ext = mapMimeTypeToExt(image.type);
                  // const {hash, ext} = extractInfoFromUrl(image.link);
                  // save the data
                  this._top100.addHash(hash, image.views);
                  this._img_views.addHash(hash, image.views);
                  this._img_ext_map.addHash(hash, ext);
                }
              }
            }

            // we normalize the columns. (e.g. "in_most_viral"->"viral"
            // The different api calls return them named differently.
            // When we go to export, it's harder to fix because we can't page the data.
            // Right now, we have bite sized chunks of data and we need to burn some time between queries anyways.
            // We also want to control the order.

            // save post data as [string] of json, we'll join strings later, then save.
            // we do this to take pressure off the GC, this data has a ton of small objects in them
            // by converting to a string now, we allow that memory to be freed up. This is important
            // because we're saving all this data IN MEMORY as we loop over every album the user has.
            // This order is also used in exporting.
            const escaped_title = JSON.stringify(row.title);
            const timestamp = JSON.stringify(new Date(row.datetime * 1000).toLocaleString());
            this._allreplies.push(`{"hash":"${row.id}","title":${escaped_title},"points":${row.points},` +
                `"ups":${row.ups},"downs":${row.downs},"views":${row.views},"comment_count":${row.comment_count},` +
                `"favorite_count":${row.favorite_count},"viral":${row.in_most_viral},"timestamp":${timestamp}}`);

          } catch (err) {
            logerr(err, err.stack);
          }
          this._running_count++;
        }
      } catch (err) {
        logerr(err, err.stack);
      }
    }

    /**
     * Fetch data, preprocess it, save into memory. posts
     * @param ii {int}
     * @return {Promise<boolean>}
     * @protected
     */
    async _fetchStep(ii) {
      try {
        // const url = `https://imgur.com/user/${this._username}/submitted/page/${ii}/miss.json?scrolling`;
        const url = `https://api.imgur.com/3/account/${this._username}/submissions/${ii}/newest?album_previews=1&client_id=546c25a59c58ad7`;
        const referrer = `https://imgur.com/user/${this._username}/posts`;

        const response_json = await imgurFetch(url, referrer, LoadPostDataClass._json_reviver_posts);
        if (response_json === false || response_json.data.length === 0) {
          return false;
        }

        await this._process_response_json(response_json.data);

        return true;
      } catch (err) {
        logerr(err, err.stack);
        return false;
      }
    }

    /**
     * @return {Promise<void>}
     * @protected
     */
    async _saveData() {
      try {
        // do not save for cancel
        if (GLOBALS.cancel_load) {
          trace('not saving data because cancel');
          return;
        }
        if (this._allreplies.length === 0) {
          trace('nothing to save');
          return;
        }

        await super._saveData();
        let finaljson_str;
        if (this._merge) {
          // O(N^2) operation. But only used for smaller refresh so should be reasonable.
          // outer loop is the smaller array. It will often match EARLY in the bigger array and break.
          // NOTE: we update the old_data with the newly fetched data, then save it back out.
          setprogressbar(.95, `merging data...`);
          const update_data = jsonParseSafe('[' + this._allreplies.join(',') + ']', []);
          let [old_data] = await getAllPostDataSavedByUser(this._username);
          for (let ii = 0; ii < update_data.length; ii++) {
            try {
              const update_item = update_data[ii];
              let found = false;
              for (let jj = 0; jj < old_data.length; jj++) {
                const old_item = old_data[jj];
                if (update_item['hash'] === old_item['hash']) {
                  // TODO: not sure on the performance trade-off of comparing the old and new or just replacing the old
                  // assuming blind write operations of same data are more expensive that serializing json and compare
                  if (JSON.stringify(update_item) !== JSON.stringify(old_item)) {
                    trace(` Updating Post data for '${old_item['hash']}' ii=${ii} jj=${jj} for user ${this._username}`);
                    // remove that entry and insert the one.
                    old_data.splice(jj, 1, update_item);
                  } else {
                    trace(` Post data for 'hash' is unchanged`);
                  }
                  found = true;
                  break;
                }
              }

              // if the above loop found an entry, then we don't need to insert the new one.
              if (!found) {
                old_data.unshift(update_item); // prepend to start to preserve newest-first order
                // old_data.push(update_item);
              }
            } catch (err) {
              logerr(err, err.stack);
            }
          }
          setprogressbar(1.0, MESSAGES.DONE_PROGRESSBAR_HTML);
          finaljson_str = JSON.stringify(old_data);
        } else {
          trace('NOT merging, just replacing POST data');
          finaljson_str = '[' + this._allreplies.join(',') + ']';
        }

        await putSavedStr(this._username, WEBCACHE_KEYS.POSTSDATA, finaljson_str);
        await putSavedStr(this._username, WEBCACHE_KEYS.LASTMODPOSTS, new Date().toLocaleString());

      } catch (err) {
        logerr(err, err.stack);
      }
    }
  }

  class LoadImagesDataClass extends _AbstractLoadUserDataFromImgur {
    /** variables */
        // we have to do two queries to get all the information.
        // First fetch gets meta query, extracts image hash ids puts them in a queue
        // second fetches batches up image hashes (from the queue) to get counts.
    _hash_queue = [];

    constructor(maxpostpages = MAX_POST_PAGES_PER_LOOP, merge = false) {
      super(maxpostpages, merge);
    }

    // <editor-fold defaultstate="collapsed" desc="-- json revivers  --">
    /**
     {
  "data": {
    "isPro": false,
    "count": 6789,
    "images": [
      {
        "hash": "Gr0Fab5",
        "ext": ".png",
        "title": "",
        "description": "",
        "mimetype": "image\/png",
        "animated": false,
        "looping": false,
        "video_source": null,
        "video_host": null,
        "prefer_video": false,
        "isAd": false,
        "is_viral": 0,
        "has_sound": false,
        "views": 0,
        "deletehash": "0ieGKGlecjSxq2n",
        "name": "placeholder-imgurgeeks-tool",
        "datetime": "2020-06-13 20:41:41",
        "date": "2 days ago",
        "size": 47492,
        "width": "1239",
        "height": "416",
        "bandwidth": 0,
        "source": "",
        "ups": 0,
        "downs": 0,
        "nsfw": false,
        "in_gallery": false
      },
     */
    // "meta" means a page of images without the view data
    static _json_reviver_meta_images(key, value) {
      // keys we want.
      // todo: title, description, name could be used to implement a search feature.
      if (['', 'data', 'count', 'images', 'hash', 'ext', 'title', 'description', 'name'].includes(key)) {
        // trace(`_json_reviver_meta_images keep '${key}' `, value);
        return value ? value : '';  // map null to empty string.
      }
      // this is required to keep nested object data.
      // for arrays, this will be a number, so let's check that.
      if (typeof value === 'object' && isNaN(key) === false) {
        // trace(`_json_reviver_meta_images keep object '${key}' `, value);
        return value;
      }
      //trace(`_json_reviver_meta_images reject '${key}'`);
      return undefined;
    };

    /**
     {
     "data": {
      "Gr0Fab5": "123",
      "MLh5sHH": "36",
      "5DyYQ8Q": "37"
    },
     **/
    static _json_reviver_stats_images(key, value) {
      // we keep all the keys, but hash keys we want to convert the value to a number.
      if (['', 'data', 'success'].includes(key)) {
        return value ? value : '';  // map null to empty string. No other type conversion
      }
      return parseInt(value);
    };

    // </editor-fold>

    /**
     * @param username {string}
     * @return {Promise<void>}
     * @protected
     */
    async _init(username) {
      try {
        await super._init(username);
        if (this._merge) {
          // we are updating. We want to always recheck the top200, they are the most likely
          // to have more views. So put those in the queue
          const hashs_arr = this._top100.getHashs();
          if (hashs_arr.length > 0) {
            this._hash_queue = [...this._hash_queue, ...hashs_arr];
          }
        }
      } catch (err) {
        logerr(err, err.stack);
        alert(MESSAGES.ERROR_OUT_OF_MEMORY);
      }
    }

    /**
     * Fetch data, preprocess it, save into memory.
     * @param ii {int}
     * @return {Promise<boolean>}
     * @private
     */
    async _fetchStep(ii) {
      try {
        // two fetches, the first loads a page of image meta data, but the views field is always empty.
        // the second will load view data.
        {
          const url = `https://${this._username}.imgur.com/ajax/images?sort=0&order=1&album=0&page=${ii}&perPage=${IMAGES_PER_PAGE_FETCH}`;
          const referrer = `https://imgur.com/user/${this._username}/posts`;

          const response_json = await imgurFetch(url, referrer, LoadImagesDataClass._json_reviver_meta_images);
          if (response_json === false || response_json.data.length === 0) {
            return false;
          }

          await this._process_meta_step1_response_json(response_json.data);
          if (this._hash_queue.length === 0) {
            return false; // done.
          }
        }

        // we need to fetch the unprocessed images from the last request.
        // we don't send too many in a batch, so we loop over all items in the queue
        // sending 60x at a time. (This is the default page size imgur uses).
        while ((this._hash_queue.length > 0) && (GLOBALS.cancel_load === false)) {
          // pull 60 off front
          const hash_list_str = this._hash_queue.slice(0, 60).join(',');
          this._hash_queue = this._hash_queue.slice(60);

          const url = `https://${this._username}.imgur.com/ajax/views?images=${hash_list_str}`;
          const referrer = `https://imgur.com/user/${this._username}/posts`;

          const response_json = await imgurFetch(url, referrer, LoadImagesDataClass._json_reviver_stats_images);
          if (response_json === false || response_json.data.length === 0) {
            return false;
          }

          await this._process_image_stats_step2_response_json(response_json.data);
          if (this._hash_queue.length) {
            // looping again, so don't rush
            await sleep(250); // todo: move into GLOBALS and adjust based on load
          }
        }

        return true;
      } catch (err) {
        logerr(err, err.stack);
        return false;
      }
    }

    async _process_meta_step1_response_json(response_json) {
      try {
        // json response includes a total count of all images on the account? Neat?
        const total_images_on_account = response_json.count || 0;
        if (this._merge === false) {
          this._total_count = Math.max(this._total_count, total_images_on_account);
        } else {
          this._total_count = (REFRESH_PAGES * IMAGES_PER_PAGE_FETCH) + (TOP_N_SAVE_SIZE);
        }

        for (const meta of response_json.images) {
          try {
            this._img_ext_map.addHash(meta.hash, meta.ext);
            // add to queue for 2nd "get view count" query.
            this._hash_queue.push(meta.hash);

            // search feature, save data
            // if (meta.title !== '' && meta.description !== '') {
            //   this.search_data_queue[meta.hash] = `{title:"${meta.title},desc:"${meta.description}",file:"${meta.name}"`;
            // }
          } catch (err) {
            logerr(err, err.stack);
            // keep trying
          }
        }
      } catch (err) {
        logerr(err, err.stack);
      }
    };

    async _process_image_stats_step2_response_json(response_json) {
      try {
        await this._top100.addHashes(response_json);
        const num_processed = await this._img_views.addHashes(response_json);
        this._running_count += num_processed;
      } catch (err) {
        logerr(err, err.stack);
      }
    }

    /**
     * final saving fo data into webcache
     * @return {Promise<void>}
     * @protected
     */
    async _saveData() {
      try {
        if (GLOBALS.cancel_load) {
          trace('not saving data because cancel');
          return;
        }

        await super._saveData();
      } catch (err) {
        logerr(err, err.stack);
      }
    }
  }

  /**
   *
   * @param username {string} passing empty clears everything
   * @return {Promise<void>}
   */
  async function removeAllDataFromCacheByUser(username) {
    try {
      const key_objects = await GLOBALS.webcache.keys();
      for (const eachitem of key_objects) {
        // if there's a username, then filter on it, if not, then delete everything.
        if (username !== '') {
          if (!eachitem.url.match(`.${username}.`)) {
            continue;
          }
        }
        await GLOBALS.webcache.delete(eachitem);
      }

    } catch (err) {
      logerr(err, err.stack);
    }
  }

  /**
   * just remove the per-image data
   * @param username {string}
   * @return {Promise<void>}
   */
  async function removeImageDataFromCacheByUser(username) {
    try {
      // remove data from webcache (could do as loop but more obvious which keys are included this way
      await deleteSavedData(username, WEBCACHE_KEYS.TOPVIEWS);
      await deleteSavedData(username, WEBCACHE_KEYS.IMGVIEWS);
      await deleteSavedData(username, WEBCACHE_KEYS.HASHTYPEBIN);
      await deleteSavedData(username, WEBCACHE_KEYS.LASTMODIMAGES);
    } catch (err) {
      logerr(err, err.stack);
    }
  }


  // absolute reset.
  // it would make more sense (UI wise) to do from the Options panel, but it doesn't have context access
  // to delete things from the cache.
  /**
   *
   * @return {Promise<void>}
   */
  async function forceClearEverything() {
    try {
      await removeAllDataFromCacheByUser(''); // delete everything.
      await localStorage.removeItem('imgurgeeks_primary_username');
      await localStorage.removeItem('imgurgeeks_save_settings');

    } catch (err) {
      logerr(err, err.stack);
    }
  }


  /**
   * Main function is used to set up async/await and allow us to "return" if there's an error.
   * @return {Promise<void>}
   */
  async function main() {
    try {
      // we try to play nice. imgur HEAVLY using localStorage and there's a limited about of that,
      // so we use the webcache
      //  see navigator.storage.estimate below... so. much. space.
      GLOBALS.webcache = await caches.open(WEBCACHE_KEYS.STORAGE_ROOT);

      const username = await getUsername();

      // this is a forwards compatibility thing. make sure we save the version if it's not saved.
      // NOTE: the username is static. We want it global across all data.
      const saved_data_version = await getSavedStr(WEBCACHE_KEYS.DATAVERSION, WEBCACHE_KEYS.DATAVERSION);
      if (saved_data_version !== '' && saved_data_version !== DATA_VERSION) {
        // ok, logic for if the data is deprecated.
        await forceClearEverything();
        // save off the new vers
        await putSavedStr(WEBCACHE_KEYS.DATAVERSION, WEBCACHE_KEYS.DATAVERSION, DATA_VERSION);
        setTimeout(() =>setMessageHtml(MESSAGES.DATA_RESET_HTML), 2000);
      }

      await setUpPage();

      // this background extension script injected google's graphing library so we can use it.
      const usernames = await listAllSavedUsernames();

      for (let ii = 0; ii < usernames.length; ii++) {
        const username = usernames[ii];

        if (username === '') {
          setMessageHtml(MESSAGES.ERROR_SIGNIN_HTML);
          setUIState(UI_STATES.NO_DATA);
          return;
        }

        const aggregatedata = await getSummaryData(username);
        if (aggregatedata === null) {
          setUIState(UI_STATES.NO_DATA);
          return;
        }

        await displaySummaryData(aggregatedata);
      }


      if (username === '') {
        // we could provide a direct link to imgur's login, but it seems safer to NOT do so.
        setMessageHtml(MESSAGES.ERROR_NEED_SIGNIN_FULL_HTML);
        setUIState(UI_STATES.NEEDS_LOGIN);
      } else if (usernames.includes(username)) {
        setUIState(UI_STATES.HAS_DATA_IDLE);
        await displayImgViewDetails();
      } else {
        setUIState(UI_STATES.NO_DATA);
      }

      // // How to determine how much space is being used.
      // navigator.storage.estimate().then(function (estimate) {
      //   const percent = (estimate.usage / estimate.quota * 100).toFixed(2);
      //   const usage = new Intl.NumberFormat().format(estimate.usage);
      //   const quota = new Intl.NumberFormat().format(estimate.quota);
      //   trace(`Domain cache quota check
      //         estimate.usage: ${usage}
      //         estimate.quota: ${quota}
      //         usage: ${percent}%
      // `);
      // });
    } catch (err) {
      logerr(err, err.stack);
    }
  }

  // noinspection JSIgnoredPromiseFromCall
  main();

} catch (err) {
  console.log('imgurgeeks extension error', err, err.stack);
  debugger;
}
// this code only seems long because of comments.