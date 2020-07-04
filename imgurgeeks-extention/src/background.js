'use strict';


// single point to turn on/off console
const ERR_BREAD_ENABLED = true;
const TRACE_ENABLED = true;

/* eslint-disable: no-console no-undef no-octal-escape no-octal */
const logerr = (...args) => {
  if (ERR_BREAD_ENABLED) {
    // red color
    console.log('%c imgurgeeks-tool ', 'color: white; font-weight: bold; background-color: red', ...args);
    debugger;
  }
};
const trace = (...args) => {
  if (TRACE_ENABLED) {
    // blue color , no break
    console.log('%c imgurgeeks-tool ', 'color: white; font-weight: bold; background-color: blue', ...args);
  }
};


let Settings = DEFAULT_SETTINGS;    // loaded by extension manifest

// load all keys
chrome.storage.local.get(DEFAULT_SETTINGS, function (settings) {
  Settings = settings;
});

// used to update setting realtime.
chrome.storage.onChanged.addListener(function (changes, namespace) {
  try {
    for (let key in changes) {
      if (typeof changes[key].newValue === 'undefined') { // reset to default
        Settings[key] = DEFAULT_SETTINGS[key];
      } else {
        Settings[key] = changes[key].newValue;
      }
    }
  } catch (err) {
    logerr(err, err.stack);
  }
});


chrome.tabs.onUpdated.addListener(async function (/*integer*/ tabId, /* object */ changeInfo, /* Tab */ tab) {
  try {
    if (!tab.url) {
      return;
    }
    // trying to stop the 404 page from flashing.
    // Will probably run multiple times, the script itself needs to be smart about not running twice.
    if (tab.url.startsWith('https://imgur.com/a/tponNW4')) {
      switch (changeInfo.status) {
        case 'loading':
          chrome.tabs.insertCSS(tabId, {file: 'src/bootstrap.css'});
          chrome.tabs.insertCSS(tabId, {file: 'src/imgurgeeks_stats.css'});
          await resetInjectTargetPage(tabId);
          break;

        case 'complete':
          await injectJs(tabId, 'imgurgeeks_stats', 'document_idle');
          break;
      }
    } else if (tab.url.match(/imgur.com\/a\/\w+$/g)
        || tab.url.match(/imgur.com\/[0-9a-zA-Z]{6,}$/g)) {
      // these are the pages imgur uses to post new images. we're going to add UI to do a Delayed Post.
      trace('change info', changeInfo);
      switch (changeInfo.status) {
        case 'loading':
          chrome.tabs.insertCSS(tabId, {file: 'src/imgur_context_end.css'});
          break;

        case 'complete':
          await injectJs(tabId, 'imgur_context_end', 'document_idle');
          break;
      }
    }

  } catch (err) {
    logerr(err, err.stack);
  }
});


/**
 * we are going to use this page to display our UI,
 * so stop all the scripts from erroring when their events are triggered, we
 * reset the page the best we can.
 *
 * @param tabId {number}
 */
async function resetInjectTargetPage(tabId) {
  try {

    // clearing the content of the page is good. It stops script from generating errors, etc.
    // It fixes:
    //    Page script error from existing scripts confused by injected dom
    //    CSS interference from existing page interaction
    //    MUCH faster load times.
    chrome.tabs.executeScript(tabId, {
      code: `
        try {
          const mo = new MutationObserver(onMutation);
        
          // save the observer somewhere we can unhook once we're done.
          window.imgurgeeks = {mutationObserver: mo};
        
          // in case the content script was injected after the page is partially loaded
          onMutation([{addedNodes: [document.documentElement]}]);
          observe();
        
          function onMutation(mutations) {
            const toRemove = [];
            let body = null;
            for (const {addedNodes} of mutations) {
              for (const n of addedNodes) {
                if (n.tagName) {
                  if (n.tagName === 'HTML') {
                    mo.disconnect();  // stop recursion while we do stuff
                    // replace the page with a simplified DOM.
                    n.innerHTML = '<head><title>Loading</title></head><body style="background-color: black"></body>';
                    observe();    // go back to watching
                  } else
                    // we remove everything else until we disable observer in 'document_end'.
                    toRemove.push(n);
                }
              }
            }
          
            if (toRemove.length) {
              mo.disconnect();  // stop recursion while we remove
              for (const el of toRemove) {
                el.remove();
              }
              observe();    // go back to watching
            }
          }
        
          function observe() {
            mo.observe(document, {
              subtree: true,
              childList: true,
            });
          }
        } catch (err) {
          console.log(err, err.stack);
        }
      `,
      runAt: 'document_start',
    });

    chrome.tabs.executeScript(tabId, {
      code: `
      // we saved the observer to clear the page above, unhook it now that we're loaded.
      if (window.imgurgeeks && window.imgurgeeks.mutationObserver) {
        // console.log('removing observer');
        window.imgurgeeks.mutationObserver.disconnect();
      }
    `,
      runAt: 'document_end',
    });

  } catch (err) {
    logerr(err, err.stack);
  }
}


/**
 * Pass our settings into code. The extension context and page js context are different
 * for security reason (which is GOOD).
 * This approach for injecting seems reliable than chrome's standard executeScript.
 * Need to go back and see if future chrome releases improve things.
 *
 * @param tabId {number}
 * @param scriptfilename {String}
 * @param runAt {string}  // "document_start", "document_end", or "document_idle"
 */
async function injectJs(tabId, scriptfilename, runAt = "document_idle") {
  try {
    Settings['extensionId'] = chrome.runtime.id;
    const settings_json = JSON.stringify(Settings);
    const unique_id = `${scriptfilename}_${tabId}`;
    const src_url = chrome.extension.getURL(`src/${scriptfilename}.js`);

    const monkeyScript = `
      try {
        if (document.getElementById('${unique_id}') !== null) {
          try {
            if (window.localStorage) {
              window.localStorage.setItem('imgurgeeks_save_settings', '${settings_json}'); 
            }
          } catch(err) {
            debugger;
          }
        } else {
          let ${unique_id} = document.createElement('script');
          ${unique_id}.id = '${unique_id}';
          ${unique_id}.src = '${src_url}';
          ${unique_id}.onload = function() {
            if (window.localStorage) {
              window.localStorage.setItem('imgurgeeks_save_settings', '${settings_json}'); 
            }
            window.imgurgeeks = {settings: JSON.parse('${settings_json}') };
          };
          (document.head || document.documentElement).appendChild(${unique_id});
          }
         
      } catch(err) { debugger; }
      `;

    chrome.tabs.executeScript(tabId, {
      code: monkeyScript,
      runAt,
    }, function () {
      trace(`${scriptfilename} script inject -finish`);
    });

  } catch (err) {
    logerr(err, err.stack);
  }
}

/**
 * same as monkeyInjectJs but create a css object
 * @param tabId {number}
 * @param scriptfilename {String}
 * @param runAt {string}  // "document_start", "document_end", or "document_idle"
 */
async function monkeyInjectCss(tabId, scriptfilename, runAt = "document_start") {
  try {
    const unique_id = `${scriptfilename}_${tabId}`;   // we want collisions so we don't inject twice.

    const monkeyScript = `try {
        if (document.getElementById('${unique_id}') === null) {
          let ${unique_id} = document.createElement('link');
          ${unique_id}.type = 'text/css';
          ${unique_id}.rel = 'stylesheet';
          ${unique_id}.id = '${unique_id}';
          ${unique_id}.href = chrome.extension.getURL('src/${scriptfilename}.css');
          (document.head || document.documentElement).appendChild(${unique_id});
        }
      } catch(ex) { debugger; }`;

    chrome.tabs.executeScript(tabId, {
      code: monkeyScript,
      runAt,
    }, function () {
      trace(`background: ${scriptfilename} monkeyInjectCss -finish`);
    });

  } catch (err) {
    logerr(err, err.stack);
  }
}
