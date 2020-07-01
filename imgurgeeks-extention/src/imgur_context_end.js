try {   // scope and prevent errors from leaking out to page.

  // single point to turn on/off console
  const TRACE_ENABLED = false;    // TODO: turn off before shipping

  // like trace, but should break into debugger.
  function log(msg, ...args) {
    if (TRACE_ENABLED) {
      console.log('imgur-imgurgeeks-toos', ...args);
      debugger;
    }
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
   * It's actually fairly tricky to reliably click a button.
   * target = $('div[data-id=1448139093]').find('button.comment-vote.icon-downvote-fill')[0];
   * @param target {Object}
   * @param scrolltotarget {boolean}
   *
   * @return boolean
   */
  async function ReallyClickTheElement(target, scrolltotarget = true) {
    try {
      if (target) {

        if (scrolltotarget) {
          // can slow things down
          target.scrollIntoView(false);
          await sleep(30);
        }

        {
          let oldmousedownevt = document.createEvent('MouseEvents');
          oldmousedownevt.initEvent('mousedown', true, true);
          target.dispatchEvent(oldmousedownevt);
        }

        // could do a random delay here to make it seem more organic?
        await sleep(30);

        {
          let oldmouseupevt = document.createEvent('MouseEvents');
          oldmouseupevt.initEvent('mouseup', true, true);
          target.dispatchEvent(oldmouseupevt);
        }

        {
          let oldmouseclickevt = document.createEvent('MouseEvents');
          oldmouseclickevt.initEvent('click', true, true);
          target.dispatchEvent(oldmouseclickevt);
        }
        await sleep(50);
      }
      return true;
    } catch (err) {
      log(err);
      await sleep(100);
    }
    return false;
  }


  let NewPostPageFixer = {
    posttimer: null,
    secsUntilPost: 0,
    BUTTON_TITLE: 'ImgurGeeks Post Delay...',

    PatchNewPostPage: async function () {
      try {
        const parentdiv = document.querySelector('div.post-actions').parentElement;
        if (!parentdiv) {
          return;
        }

        const divider = document.createElement('div');
        divider.className = 'divider';
        parentdiv.append(divider);

        const new_elem_html = `
          <a class="post-options-publish btn btn-action" id="imgurgeeks_posttimer">${this.BUTTON_TITLE}</a>
          <br><br>
          <span id="timer_running_msg" class="invisible">Timer is now running.
          Make sure you have a title and all the tags you want. 
          Leaving this page or refreshing will stop timer.</span>
        `;
        const newspan = document.createElement('span');
        newspan.innerHTML = new_elem_html;
        parentdiv.append(newspan);

        document.addEventListener('click', async (e) => {
          if (e.target === null || e.target.id === null) {
            return;
          }
          switch (e.target.id) {
            case 'imgurgeeks_posttimer':
              if (NewPostPageFixer.posttimer) {
                clearInterval(NewPostPageFixer.posttimer);
                NewPostPageFixer.posttimer = null;
                document.getElementById('timer_running_msg').classList.add('invisible');
              }
              let time = window.prompt("Enter time delay to post\n Format `0h0m`", "");
              if (time !== null && time !== '') {
                let hrs = 0;
                let mins = 0;

                // remove any spaces ##h##m is the format.
                time = time.replace(/\s+/g, '');   // remove duplicate spaces
                const matches = time.match(/^([0-9]*)([a-zA-Z]*)([0-9]*)([a-zA-Z]*)$/);
                if (matches !== null && matches.length >= 5) {
                  const num1 = parseInt(matches[1] || '0');
                  const delim1 = matches[2].toLowerCase();
                  const num2 = parseInt(matches[3] || '0');

                  // is delim an hour marker?
                  if (['h', 'hr', 'hrs', 'hours'].includes(delim1)) {
                    hrs = num1;
                    mins = num2;  // fine to fudge the min...
                  } else if (['m', 'min', 'mins', 'minutes'].includes(delim1)) {
                    mins = num1;
                  }
                  // we could do more fancy stuff, but meh.
                }

                if (hrs === 0 && mins === 0) {
                  // parsing failed
                  alert(`'${time}' format does NOT match 00h00m.`);
                  return;
                }

                NewPostPageFixer.secsUntilPost = ((parseInt(hrs) * 60) + parseInt(mins)) * 60;
                if (NewPostPageFixer.secsUntilPost === 0) {
                  alert(`Time '${time} must be greater than > 0 minutes`);
                  return;
                }
                await NewPostPageFixer.PostTimerCountdown();
                NewPostPageFixer.posttimer = window.setInterval(NewPostPageFixer.PostTimerCountdown, 1000);
                document.getElementById('timer_running_msg').classList.remove('invisible');
              } else {
                await NewPostPageFixer.SetDelayPostButton();
              }
              e.preventDefault();
              break;
          }
        });
        // imgurutil_posttimer
        // post-options-publish btn btn-action
      } catch (err) {
        log(err);
      }
    },

    SetDelayPostButton: async function (newtitle = this.BUTTON_TITLE) {
      const element = document.getElementById('imgurgeeks_posttimer');
      if (element) {
        element.innerText = newtitle;
      }
    },

    PostTimerCountdown: async function () {
      if (NewPostPageFixer.secsUntilPost === 0) {
        // time to trigger!
        await NewPostPageFixer.SetDelayPostButton(' -- POSTING ---');
        window.clearInterval(NewPostPageFixer.posttimer);
        NewPostPageFixer.posttimer = null;
        await sleep(2 * 1000);
        await ReallyClickTheElement(document.querySelector('a.post-options-publish.btn.btn-action'),
            true);
        return;
      }
      NewPostPageFixer.secsUntilPost -= 1;
      const hrs = Math.floor(NewPostPageFixer.secsUntilPost / (60 * 60));
      const mins = Math.floor(NewPostPageFixer.secsUntilPost / 60 % (60));
      const secs = NewPostPageFixer.secsUntilPost % (60);

      const mins_pad = (mins < 10) ? ('0' + mins.toString()) : mins.toString();
      const secs_pad = (secs < 10) ? ('0' + secs.toString()) : secs.toString();
      const timeremaining = `Post in ${hrs}h ${mins_pad}m ${secs_pad}s...`;
      await NewPostPageFixer.SetDelayPostButton(timeremaining);
    },
  };

  async function main() {
    try {
      let url = window.location.toString();

      if (url.match(/imgur.com\/a\/\w+$/g)
          || url.match(/imgur.com\/[0-9a-zA-Z]{6,}$/g)) {
        console.log('checking if new post');  // post-options-publish btn btn-action
        const submitpostbtn = document.querySelector('a.post-options-publish.btn.btn-action');
        const submitpostbtnNEWUI = document.querySelector('button.Button-community');
        if (submitpostbtn !== null || submitpostbtnNEWUI !== null) {
          console.log('found submit button');
          await NewPostPageFixer.PatchNewPostPage();
        }
      }
    } catch (err) {
      log(err, err.stack);
    }
  }

  window.setTimeout(main, 1);

} catch (err) {
  console.log(err);
  debugger;
}
