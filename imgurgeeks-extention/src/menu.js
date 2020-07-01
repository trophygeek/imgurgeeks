'use strict';

try {
  document.getElementById('post_stats').addEventListener('click', (evt) => {
      chrome.tabs.create({
        url: "https://imgur.com/a/tponNW4"
      });
      window.close();
  });


  document.getElementById('options').addEventListener('click', (evt) =>  {
    const id = chrome.runtime.id;
    chrome.tabs.create({
      url: `chrome-extension://${id}/src/options.html`
    });
    window.close();
  });

} catch (err) {
  console.log(err);
}
