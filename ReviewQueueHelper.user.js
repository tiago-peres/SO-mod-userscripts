// ==UserScript==
// @name         Review Queue Helper
// @description  Keyboard shortcuts, skips accepted questions and audits (to save review quota)
// @homepage     https://github.com/samliew/SO-mod-userscripts
// @author       @samliew
// @version      2.0
//
// @include      https://*stackoverflow.com/review*
// @include      https://*serverfault.com/review*
// @include      https://*superuser.com/review*
// @include      https://*askubuntu.com/review*
// @include      https://*mathoverflow.net/review*
// @include      https://*.stackexchange.com/review*
//
// @include      https://*stackoverflow.com/questions/*
// @include      https://*serverfault.com/questions/*
// @include      https://*superuser.com/questions/*
// @include      https://*askubuntu.com/questions/*
// @include      https://*mathoverflow.net/questions/*
// @include      https://*.stackexchange.com/questions/*
//
// @exclude      *chat.*
// @exclude      https://stackoverflow.com/c/*
// @exclude      https://stackoverflow.blog*
//
// @grant        GM_addStyle
// ==/UserScript==


// Detect if SOMU is loaded
const rafAsync = () => new Promise(resolve => { requestAnimationFrame(resolve); });
async function waitForSOMU() {
    while(typeof SOMU === 'undefined' || !SOMU.hasInit) { await rafAsync(); }
    return SOMU;
}


(function() {
    'use strict';

    const fkey = StackExchange.options.user.fkey;
    const scriptName = GM_info.script.name;
    const isSO = location.hostname == 'stackoverflow.com';

    const superusers = [ 584192 ];
    const isSuperuser = () => superusers.includes(StackExchange.options.user.userId);

    const queueType = /^\/review/.test(location.pathname) ? location.href.replace(/\/\d+(\?.*)?$/, '').split('/').pop() : null;
    const filteredElem = document.querySelector('.review-filter-tags');
    const filteredTags = filteredElem ? (filteredElem.value || '').split(' ') : [''];
    let processReview, post = {}, flaggedReason = null;
    let isLinkOnlyAnswer = false, isCodeOnlyAnswer = false;
    let numOfReviews = 0;

    let skipAccepted = false, skipUpvoted = false, skipMultipleAnswers = false, skipMediumQuestions = false, skipLongQuestions = false, autoCloseShortQuestions = false, downvoteAfterClose = false;


    function loadOptions() {
        waitForSOMU().then(function(SOMU) {

            if(queueType == null) return;

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Skip Accepted Questions', skipAccepted, 'bool');
            // Get current custom value with default
            skipAccepted = SOMU.getOptionValue(scriptName, 'Skip Accepted Questions', skipAccepted, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Skip Upvoted Posts', skipUpvoted, 'bool');
            // Get current custom value with default
            skipUpvoted = SOMU.getOptionValue(scriptName, 'Skip Upvoted Posts', skipUpvoted, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Skip Questions with >1 Answer', skipMultipleAnswers, 'bool');
            // Get current custom value with default
            skipMultipleAnswers = SOMU.getOptionValue(scriptName, 'Skip Questions with >1 Answer', skipMultipleAnswers, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Skip Medium-length Questions', skipMediumQuestions, 'bool');
            // Get current custom value with default
            skipMediumQuestions = SOMU.getOptionValue(scriptName, 'Skip Medium-length Questions', skipMediumQuestions, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Skip Long Questions', skipLongQuestions, 'bool');
            // Get current custom value with default
            skipLongQuestions = SOMU.getOptionValue(scriptName, 'Skip Long Questions', skipLongQuestions, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Try to close short Questions', autoCloseShortQuestions, 'bool');
            // Get current custom value with default
            autoCloseShortQuestions = SOMU.getOptionValue(scriptName, 'Try to close short Questions', autoCloseShortQuestions, 'bool');

            // Set option field in sidebar with current custom value; use default value if not set before
            SOMU.addOption(scriptName, 'Downvote after Question Closure', downvoteAfterClose, 'bool');
            // Get current custom value with default
            downvoteAfterClose = SOMU.getOptionValue(scriptName, 'Downvote after Question Closure', downvoteAfterClose, 'bool');
        });
    }


    let toastTimeout, defaultDuration = 1.5;
    function toastMessage(msg, duration = defaultDuration) {
        // Validation
        duration = Number(duration);
        if(typeof(msg) !== 'string') return;
        if(isNaN(duration)) duration = defaultDuration;

        // Clear existing timeout
        if(toastTimeout) clearTimeout(toastTimeout);

        // Reuse or create new
        let div = $('#toasty').html(msg).show();
        if(div.length == 0) div = $(`<div id="toasty">${msg}</div>`).appendTo(document.body);

        // Hide div
        toastTimeout = setTimeout(function(div) {
            div.hide();
        }, duration * 1000, div);
    }


    // Close individual post
    // closeReasonId: 'NeedMoreFocus', 'OffTopic', 'NeedsDetailsOrClarity', 'OpinionBased', 'Duplicate'
    // if closeReasonId is 'OffTopic', offtopicReasonId : 11-norepro, 13-nomcve, 16-toolrec, 3-custom
    function closeQuestionAsOfftopic(pid, closeReasonId = 'OffTopic', offtopicReasonId = 3, offTopicOtherText = '', duplicateOfQuestionId = null) {
        return new Promise(function(resolve, reject) {
            if(!isSO) { reject(); return; }
            if(typeof pid === 'undefined' || pid === null) { reject(); return; }
            if(typeof closeReasonId === 'undefined' || closeReasonId === null) { reject(); return; }
            if(closeReasonId === 'OffTopic' && (typeof offtopicReasonId === 'undefined' || offtopicReasonId === null)) { reject(); return; }

            if(closeReasonId === 'Duplicate') offtopicReasonId = null;

            // Logging actual action
            console.log(`%c Closing ${pid} as ${closeReasonId}, reason ${offtopicReasonId}.`, 'font-weight: bold');

            $.post({
                url: `https://${location.hostname}/flags/questions/${pid}/close/add`,
                data: {
                    'fkey': fkey,
                    'closeReasonId': closeReasonId,
                    'closeAsOffTopicReasonId': offtopicReasonId,
                    'duplicateOfQuestionId': duplicateOfQuestionId,
                    'offTopicOtherText': offtopicReasonId == 3 && isSO ? 'This question does not appear to be about programming within the scope defined in the [help]' : offTopicOtherText,
                    //'offTopicOtherCommentId': '',
                    'originalOffTopicOtherText': 'I\'m voting to close this question as off-topic because ',
                }
            })
            .done(resolve)
            .fail(reject);
        });
    }


    // Downvote individual post
    function downvotePost(pid) {
        return new Promise(function(resolve, reject) {
            if(typeof pid === 'undefined' || pid === null) { reject(); return; }

            $.post({
                url: `https://${location.hostname}/posts/${pid}/vote/3`,
                data: {
                    fkey: fkey
                }
            })
            .done(resolve)
            .fail(reject);
        });
    }


    function skipReview() {

        // If referred from meta or post timeline, and is first review, do not automatically skip
        if((document.referrer.includes('meta.') || /\/posts\/\d+\/timeline/.test(document.referrer)) && numOfReviews <= 1) {
            console.log('Not skipping review as it was opened from Meta or post timeline page.');
            return;
        }

        setTimeout(function() {
            $('.js-review-actions').find('button[title="skip this question"], button[title="review next item"]').click();
        }, 500);
    }


    function isAudit() {

        let audit = false;

        // Post does not have any of the filtered tags
        if(post.tags && post.tags.length && filteredTags[0] !== '' && !filteredTags.some(t => post.tags.includes(t))) {
            audit = true;
        }

        // Check post score
        else if(!isNaN(post.votes)) {

            let votes, error = false;
            $.ajax({
                url: `https://${location.hostname}/posts/${post.id}/vote-counts`,
                async: false
            }).done(function(data) {
                votes = Number(data.up) + Number(data.down);
            }).fail(function() {
                console.error('failed fetching vote counts');
                error = true;
            });

            // Displayed post score not same as fetched vote score
            if(!error && votes !== post.votes) audit = true;
        }

        console.log("audit:", audit);
        return audit;
    }


    function processCloseReview() {

        // Question has an accepted answer, skip if enabled
        if(skipAccepted && post.isQuestion && post.accepted) {
            console.log('skipping accepted question');
            toastMessage('skipping accepted question');
            skipReview();
            return;
        }

        // Post has positive score, skip if enabled
        if(skipUpvoted && post.votes > 3) {
            console.log('skipping upvoted post');
            toastMessage('skipping upvoted post');
            skipReview();
            return;
        }

        // Question has multiple answers, skip if enabled
        if(skipMultipleAnswers && post.isQuestion && post.answers > 1) {
            console.log('skipping question with >1 answer');
            toastMessage('skipping question with >1 answer');
            skipReview();
            return;
        }

        // Question body is too long, skip if enabled
        if(skipLongQuestions && post.isQuestion && post.content.length > 3000) {
            console.log('skipping long-length question, length ' + post.content.length);
            toastMessage('skipping long-length question, length ' + post.content.length);
            skipReview();
            return;
        }

        // Question body is of medium length, skip if enabled
        if(skipMediumQuestions && post.isQuestion && post.content.length > 1200) {
            console.log('skipping medium-length question, length ' + post.content.length);
            toastMessage('skipping medium-length question, length ' + post.content.length);
            skipReview();
            return;
        }

        // Question body is short, try to close if enabled
        if(autoCloseShortQuestions && post.isQuestion && post.content.length < 500) {
            console.log('short question detected, length ' + post.content.length);
            $('.js-review-actions button[title*="Close"]').click();
            return;
        }
    }


    function processLowQualityPostsReview() {

        const postEl = $('.reviewable-answer .post-text');
        const postText = postEl.text();
        const postHtml = postEl.html();
        const postNoCodeHtml = postEl.clone(true, true).find('pre, code').remove().end().html();

        // If post type is an answer
        if(!post.isQuestion) {

            // If is a short answer and there is a link in the post, select "link-only answer" option in delete dialog
            if(postText.length < 300 && /https?:\/\//.test(postHtml)) {
                isLinkOnlyAnswer = true;
                console.log('Possible link-only answer detected.');
            }

            // Try to detect if the post contains mostly code
            else if(postEl.find('pre, code').length > 0 &&
                    (postNoCodeHtml.length < 50 || postHtml.length / postNoCodeHtml.length > 0.9)) {
                isCodeOnlyAnswer = true;
                console.log('Possible code-only answer detected.');
            }
        }
    }


    function insertInstantCloseButtons() {

        const actionsCont = $('.js-review-actions-error-target').first();
        if(actionsCont.length == 0) return;
        actionsCont.children('.instant-actions').remove();

        const instantActions = $('<span class="instant-actions grid gs8 jc-end ff-row-wrap">'
+ '<button class="s-btn s-btn__outlined grid--cell" data-instant="unclear" title="Needs details or clarity">[6] Unclear</button>'
+ '<button class="s-btn s-btn__outlined grid--cell" data-instant="broad" title="Needs more focus">[7] Broad</button>'
+ '<button class="s-btn s-btn__outlined grid--cell" data-instant="softrec" title="It\'s seeking recommendations for books, software libraries, or other off-site resources">[8] SoftRec</button>'
+ '<button class="s-btn s-btn__outlined grid--cell" data-instant="debug" title="It\'s seeking debugging help but needs more information">[9] Debug</button>'
+ '<button class="s-btn s-btn__outlined grid--cell" data-instant="opinion" title="Opinion-based">[0] Opinion</button>'
+ '</span>').appendTo(actionsCont);

        instantActions.one('click', 'button[data-instant]', function() {
            actionsCont.find('.instant-actions button').prop('disabled', true);
            const pid = post.id;

            // closeQuestionAsOfftopic() :
            // closeReasonId: 'NeedMoreFocus', 'OffTopic', 'NeedsDetailsOrClarity', 'OpinionBased', 'Duplicate'
            // if closeReasonId is 'OffTopic', offtopicReasonId : 11-norepro, 13-nomcve, 16-toolrec, 3-custom
            let error = false;
            switch(this.dataset.instant) {
                case 'unclear':
                    closeQuestionAsOfftopic(pid, 'NeedsDetailsOrClarity');
                    break;
                case 'broad':
                    closeQuestionAsOfftopic(pid, 'NeedMoreFocus');
                    break;
                case 'softrec':
                    closeQuestionAsOfftopic(pid, 'OffTopic', 16);
                    break;
                case 'debug':
                    closeQuestionAsOfftopic(pid, 'OffTopic', 13);
                    break;
                case 'opinion':
                    closeQuestionAsOfftopic(pid, 'OpinionBased');
                    break;
                default: {
                    error = true;
                    console.error('invalid option');
                }
            }

            if(!error) {
                // immediately skip to next review
                instantActions.remove();
                $('.js-review-actions button[title="skip this question"]').click();
            }
        });
    }


    function insertVotingButtonsIfMissing() {

        const voteCont = $('.js-voting-container').first();
        if(voteCont.length == 0) return;

        const upvoteBtn = `<button class="js-vote-up-btn grid--cell s-btn s-btn__unset c-pointer" title="This question shows research effort; it is useful and clear" aria-pressed="false" aria-label="up vote" data-selected-classes="fc-theme-primary"><svg aria-hidden="true" class="svg-icon m0 iconArrowUpLg" width="36" height="36" viewBox="0 0 36 36"><path d="M2 26h32L18 10 2 26z"></path></svg></button>`;
        const dnvoteBtn = `<button class="js-vote-down-btn grid--cell s-btn s-btn__unset c-pointer" title="This question does not show any research effort; it is unclear or not useful" aria-pressed="false" aria-label="down vote" data-selected-classes="fc-theme-primary"><svg aria-hidden="true" class="svg-icon m0 iconArrowDownLg" width="36" height="36" viewBox="0 0 36 36"><path d="M2 10h32L18 26 2 10z"></path></svg></button>`;

        if(voteCont.find('.js-vote-up-btn, .js-vote-down-btn').length != 2) {
            voteCont.find('.fs-caption').remove();
            voteCont.find('.fc-black-500').removeClass('fc-black-500');
            voteCont.find('.js-vote-count').removeClass('mb8').addClass('fc-black-500').before(upvoteBtn).after(dnvoteBtn);

            StackExchange.question.fullInit('.question');
            StackExchange.question.fullInit('.answer');
        }
    }


    function listenToKeyboardEvents() {

        // Focus Delete button when radio button in delete dialog popup is selected
        $(document).on('click', '#delete-question-popup input:radio', function() {
            $('#delete-question-popup').find('input:submit').focus();
        });

        // Focus Flag button when radio button in flag dialog popup is selected, UNLESS it's the custom reason option
        $(document).on('click', '#popup-flag-post input:radio', function(evt) {

            // If custom reason option, do nothing
            if(this.value == 'PostOther') return;

            $('#popup-flag-post').find('input:submit').focus();
        });

        // Focus Reject button when radio button in edit reject dialog popup is selected
        $(document).on('click', '#rejection-popup input:radio', function() {
            $('#rejection-popup').find('input:submit').focus();
        });

        // Cancel existing handlers and implement our own keyboard shortcuts
        $(document).off('keypress keyup');

        // Keyboard shortcuts event handler
        $(document).on('keyup', function(evt) {

            // Back buttons: escape (27)
            // Unable to use tilde (192) as on the UK keyboard it is swapped the single quote keycode
            const cancel = evt.keyCode === 27;
            const goback = evt.keyCode === 27;

            // Get numeric key presses
            let index = evt.keyCode - 49; // 49 = number 1 = 0 (index)
            if(index == -1) index = 9; // remap zero to last index
            if(index < 0 || index > 9) { // handle 1-0 number keys only (index 0-9)

                // Try keypad keycodes instead
                let altIndex = evt.keyCode - 97; // 97 = number 1 = 0 (index)
                if(altIndex == -1) index = 9; // remap zero to last index
                if(altIndex >= 0 && altIndex <= 9) {
                    index = altIndex; // handle 1-0 number keys only (index 0-9)
                }
                else {
                    // Both are invalid
                    index = null;
                }
            }
            //console.log("keypress", evt.keyCode, "index", index);

            // Do nothing if key modifiers were pressed
            if(evt.shiftKey || evt.ctrlKey || evt.altKey) return;

            // If edit mode, cancel if esc is pressed
            if(cancel && $('.editing-review-content').is(':visible')) {
                $('.js-review-cancel-button').click();
                return;
            }

            // Do nothing if a textbox or textarea is focused
            if($('input:text:focus, textarea:focus').length > 0) return;

            // Is close menu open?
            const closeMenu = $('#popup-close-question:visible');
            if(closeMenu.length > 0) {

                // If escape key pressed, go back to previous pane, or dismiss popup if on main pane
                if(goback) {
                    // Get link in breadcrumbs
                    const link = closeMenu.find('.popup-breadcrumbs a').last();
                    // Go back to previous pane if possible
                    if(link.length) {
                        link.click();
                    }
                    // Dismiss popup if on main pane
                    else {
                        closeMenu.find('.popup-close a').click();
                    }
                    // Clear dupe closure search box
                    $('#search-text').val('');
                    return false;
                }

                // If valid index, click it
                else if(index != null) {
                    // Get active (visible) pane
                    const pane = closeMenu.find('.popup-active-pane');
                    // Get options
                    const opts = pane.find('input:radio');
                    // Click option
                    const opt = opts.eq(index).click();
                    // Job is done here. Do not bubble if an option was clicked
                    return opt.length !== 1;
                }

                return;
            }

            // Is delete menu open?
            const deleteMenu = $('#delete-question-popup:visible');
            if(deleteMenu.length > 0) {

                // Dismiss popup on escape key
                if(goback) {
                    deleteMenu.find('.popup-close a').click();
                    return false;
                }

                // If valid index, click it
                else if(index != null) {
                    // Get active (visible) pane
                    const pane = deleteMenu.find('.popup-active-pane');
                    // Get options
                    const opts = pane.find('input:radio');
                    // Click option
                    const opt = opts.eq(index).click();
                    // Job is done here. Do not bubble if an option was clicked
                    return opt.length !== 1;
                }

                return;
            }

            // Is flag menu open?
            const flagMenu = $('#popup-flag-post:visible');
            if(flagMenu.length > 0) {

                // Dismiss popup on escape key
                if(goback) {
                    flagMenu.find('.popup-close a').click();
                    return false;
                }

                // If custom mod flag box is focused, do nothing
                else if($('.mod-attention-subform textarea:focus').length == 1) {
                    return false;
                }

                // If valid index, click it
                else if(index != null) {
                    // Get options
                    const opts = flagMenu.find('input:radio');
                    // Click option
                    const opt = opts.eq(index).click();
                    // Job is done here. Do not bubble if an option was clicked
                    return opt.length !== 1;
                }

                return;
            }

            // Is reject menu open?
            const rejectMenu = $('#rejection-popup:visible');
            if(rejectMenu.length > 0) {

                // Dismiss popup on escape key
                if(goback) {
                    rejectMenu.find('.popup-close a').click();
                    return false;
                }

                // If custom mod flag box is focused, do nothing
                else if($('textarea.custom-reason-text:focus').length == 1) {
                    return false;
                }

                // If valid index, click it
                else if(index != null) {
                    // Get options
                    const opts = rejectMenu.find('input:radio');
                    // Click option
                    const opt = opts.eq(index).click();
                    // Job is done here. Do not bubble if an option was clicked
                    return opt.length !== 1;
                }

                return;
            }

            // If escape key pressed and close popup dialog not open, do nothing
            if(goback) {
                return;
            }

            // Review action buttons
            if(index != null && index <= 4) {
                //console.log('review action', 'keyCode', evt.keyCode, 'index', index);

                const btns = $('.js-review-actions button');
                // If there is only one button and is "Next", click it
                if(btns.length === 1) {
                    index = 0;
                }

                // Default to clicking review buttons based on index
                btns.eq(index).click();
                return false;
            }
            // Instant action buttons
            else if(index != null && index >= 5) {
                //console.log('instant action', 'keyCode', evt.keyCode, 'index', index);

                const btns = $('.instant-actions button');
                btns.eq(index - 5).click();
                return false;
            }
        });
    }


    function doPageLoad() {

        listenToKeyboardEvents();

        // Focus VTC button when radio button in close dialog popup is selected
        $(document).on('click', '#popup-close-question input:radio', function(evt) {

            // If dupe radio, do nothing
            if(this.value === 'Duplicate') return;

            // If custom reason option, do nothing
            if(this.value == '3') return;

            // If migrate anywhere radio, do nothing
            if(this.id === 'migrate-anywhere') return;

            $('#popup-close-question').find('input:submit').focus();
        });

        // No queue detected, do nothing. Required for ajaxComplete function below
        if(queueType == null) return;
        console.log('Review queue:', queueType);

        // Add additional class to body based on review queue
        document.body.classList.add(queueType + '-review-queue');

        // Append review queue styles
        addReviewQueueStyles();

        // Detect queue type and set appropriate process function
        switch(queueType) {
            case 'close':
                processReview = processCloseReview; break;
            case 'reopen':
                processReview = processCloseReview; break;
            case 'suggested-edits':
                processReview = processCloseReview; break;
            case 'helper':
                processReview = processCloseReview; break;
            case 'low-quality-posts':
                processReview = processLowQualityPostsReview; break;
            case 'triage':
                processReview = processCloseReview; break;
            case 'first-posts':
                processReview = processCloseReview; break;
            case 'late-answers':
                processReview = processCloseReview; break;
            default:
                break;
        }
    }


    function repositionReviewDialogs(scrollTop = true) {

        // option to scroll to top of page
        scrollTop ? setTimeout(() => window.scrollTo(0,0), 100) : 0;

        // position dialog
        $('.popup').css({
            top: 100,
            left: 0
        });
    }


    function listenToPageUpdates() {

        // On any page update
        $(document).ajaxComplete(function(event, xhr, settings) {

            // Do nothing with fetching vote counts
            if(settings.url.includes('/vote-counts')) return;

            // Do nothing with saving preferences
            if(settings.url.includes('/users/save-preference')) return;

            // Close dialog loaded
            if(settings.url.includes('/close/popup')) {
                setTimeout(function() {

                    repositionReviewDialogs(true);

                    // Find and add class to off-topic bounty indicator so we can avoid it
                    $('#popup-close-question input[value="OffTopic"]').nextAll('.bounty-indicator-tab').addClass('offtopic-indicator');

                    // Select default radio based on previous votes, ignoring the off-topic reason
                    let opts = $('#popup-close-question .bounty-indicator-tab').not('.offtopic-indicator').slice(0, -1).get().sort((a, b) => Number(a.innerText) - Number(b.innerText));
                    const selOpt = $(opts).last().closest('label').find('input').click();
                    //console.log(opts, selOpt);

                    // If selected option is in a subpane, display off-topic subpane instead
                    const pane = selOpt.closest('.popup-subpane');
                    if(pane.attr('id') !== 'pane-main') {

                        // Get pane name
                        const paneName = pane.attr('data-subpane-name');

                        // Select radio with same subpane name
                        $(`#popup-close-question input[data-subpane-name="${paneName}"]`).click();

                        // Re-select option
                        selOpt.click();
                    }

                    // If no popular vote, select detected general close reason
                    if(selOpt.length == 0 && ['too broad', 'unclear what you\'re asking', 'primarily opinion-based'].includes(flaggedReason)) {
                        $('#popup-close-question .action-name').filter((i, el) => el.textContent == flaggedReason).prev().click();
                    }
                }, 50);
            }

            // Delete dialog loaded
            else if(settings.url.includes('/posts/popup/delete/')) {
                setTimeout(function() {

                    // Select recommended option if there are no auto comments yet
                    if(post.comments.some(v => /- From Review/i.test(v)) == false && isLinkOnlyAnswer) {
                        $('.popup-active-pane .action-name').filter((i, el) => el.innerText.includes('link-only answer')).prev('input').click();
                    }

                    // Focus Delete button
                    $('#delete-question-popup').find('input:submit').focus();
                }, 50);
            }

            // Flag dialog loaded
            else if(settings.url.includes('/flags/posts/') && settings.url.includes('/popup')) {
                // Do nothing by default
            }

            // Question was closed
            else if(settings.url.includes('/close/add')) {
                $('.js-review-actions button[title*="close"]').attr('disabled', true);

                // If downvoteAfterClose option enabled, and score >= 0
                if(downvoteAfterClose && post.isQuestion && post.votes >= 0) {
                    console.log('post downvoted', post.id);
                    downvotePost(post.id);
                }
            }

            // Next review loaded, transform UI and pre-process review
            else if(settings.url.includes('/review/next-task') || settings.url.includes('/review/task-reviewed/')) {

                // Keep track of how many reviews were viewed in this session
                numOfReviews++;

                // Reset variables for next task
                isLinkOnlyAnswer = false;
                isCodeOnlyAnswer = false;

                // Get additional info about review from JSON response
                let responseJson = {};
                try {
                    responseJson = JSON.parse(xhr.responseText);
                    console.log(responseJson);
                }
                catch (e) {
                    console.error('error parsing JSON', xhr.responseText);
                }

                // If action was taken (post was refreshed), don't do anything else
                if(responseJson.isRefreshing) return;

                // If not review queue, do nothing (e.g.: viewing suggested edit from Q&A)
                if(queueType == null) return;

                // Parse flagged reason (to select as default if no popular vote)
                flaggedReason = (responseJson.instructions.match(/(too broad|unclear what you&#39;re asking|primarily opinion-based)/i) || ['']).pop().replace('&#39;', "'");
                console.log(flaggedReason);

                setTimeout(function() {

                    // Get post type
                    const isQuestion = $('.reviewable-post:first .answers-subheader').text().includes('Question');

                    // Get post status
                    const isClosedOrDeleted = $('.reviewable-post').first().find('.question-status, .deleted-answer').length > 0;
                    console.log('isClosedOrDeleted', isClosedOrDeleted);

                    // If no more reviews, refresh page every 10 seconds
                    // Can't use responseJson.isUnavailable here, as it can also refer to current completed review
                    if($('.review-instructions').text().includes('This queue has been cleared!')) {
                        setTimeout(() => location.reload(true), 10000);
                        return;
                    }

                    // If first-posts or late-answers queue, and not already reviewed (no Next button)
                    const reviewStatus = $('.review-status').text();
                    if((queueType == 'first-posts' || queueType == 'late-answers' || queueType == 'helper') &&
                       !reviewStatus.includes('This item is no longer reviewable.') && !reviewStatus.includes('This item is not reviewable.') && !reviewStatus.includes('Review completed')) {

                        // If question, insert "Close" option
                        if(isQuestion) {
                            const closeBtn = $(`<button class="js-action-button s-btn s-btn__primary grid--cell" title="close question">Close</button>`).attr('disabled', isClosedOrDeleted);
                            closeBtn.click(function() {
                                // If button not disabled
                                if(!$(this).prop('disabled')) {
                                    $('.post-menu').first().find('.close-question-link').click();
                                }
                                return false;
                            });
                            $('.js-review-actions button').first().after(closeBtn);
                        }

                        // Else if answer and user has delete privs, insert "Delete" option
                        else if(!isQuestion && (StackExchange.options.user.isModerator || StackExchange.options.user.rep >= 10000 && $('.post-menu a[title="vote to delete this post"]').length === 1)) {
                            const delBtn = $(`<button title="delete answer">Delete</button>`).attr('disabled', isClosedOrDeleted);
                            delBtn.click(function() {
                                // If button not disabled
                                if(!$(this).prop('disabled')) {
                                    $('.post-menu').first().find('a[title*="delete"]').click();
                                }
                                return false;
                            });
                            $('.js-review-actions button').first().after(delBtn);
                        }

                        // Show post menu if in the H&I queue
                        if(location.pathname.includes('/review/helper/')) {
                            StackExchange.question.fullInit('.question');
                            $('.close-question-link').show();
                        }
                    }

                    // If we are in H&I and review is no longer available,
                    if(queueType == 'helper' && responseJson.isUnavailable) {

                        // Remove edit button so only "Next" is displayed
                        $('.js-review-actions button').first().remove();

                        // Load link to triage review
                        $.get(`https://${location.hostname}/posts/${responseJson.postId}/timeline`)
                        .done(function(data) {
                            const triageLink = $('.event-verb a', data).filter((i, el) => el.href.includes('/triage/')).attr('href');
                            $('.reviewable-post-stats tr').eq(-2).children('td')
                                .append(`<span class="lsep">| </span><a href="${triageLink}" class="s-btn s-btn__sm s-btn__primary" title="see who voted for requires editing" target="_blank">view triage</a>`);
                        });
                    }

                    // Remove "Delete" option for suggested-edits queue, if not already reviewed (no Next button)
                    if(location.pathname.includes('/review/suggested-edits/') && !$('.review-status').text().includes('This item is no longer reviewable.')) {
                        $('.js-review-actions button[title*="delete"]').remove();
                    }

                    // Modify buttons
                    $('.js-review-actions button').removeAttr('disabled').text(function(i, v) {
                        if(v.includes('] ')) return v; // do not modify twice
                        return '[' + (i+1) + '] ' + v;
                    });

                    // Get review vars
                    post = {
                        id: responseJson.postId,
                        permalink: `https://${location.hostname}/${isQuestion ? 'q':'a'}/${responseJson.postId}`,
                        title: $('h1[itemprop="name"] a').text(),
                        content: $('.post-text').first().text(),
                        votes: parseInt($('.js-vote-count').first().text(), 10),
                        tags: $('.post-taglist .post-tag').get().map(v => v.innerText),
                        isQuestion: isQuestion,
                        isClosedOrDeleted: isClosedOrDeleted,
                        comments: $('.reviewable-post:first .comment-copy').get().map(v => v.innerText),
                    };
                    // Parse post stats from sidebar
                    $('.reviewable-post:first .reviewable-post-stats tr').each(function() {
                        let k = $(this).find('.label-key').text();
                        let v = $(this).find('.label-value').text();

                        if(k.length == 0 && v.length == 0) return;

                        // convert key to camelCase (in case of two words, like "is accepted" or "other answers"
                        k = k.replace(/[^\S\r\n]([^\s])/g, x => x.toUpperCase()).replace(/\s+/g, '');

                        // try convert to primitive
                        let d = new Date($(this).find('.label-value').attr('title')).getTime();
                        let b = v == 'no' ? false : v == 'yes' ? true : null;
                        let n = parseInt(v, 10);

                        if(!isNaN(d)) v = d; // date
                        else if(b !== null) v = b; // bool
                        else if(!isNaN(n)) v = n; // number

                        post[k] = v;
                    });
                    console.log(post);

                    // Check for audits and skip them
                    if(responseJson.isAudit) {
                        console.log('skipping review audit');
                        toastMessage('skipping review audit');
                        skipReview();
                        return;
                    }
                    //else if(isAudit()) {
                    //    console.log('skipping review audit via manual check');
                    //    skipReview();
                    //    return;
                    //}

                    // Process post based on queue type
                    if(typeof processReview === 'function') processReview();

                    // Insert voting buttons
                    insertVotingButtonsIfMissing();

                    // Insert instant buttons
                    if(isSO && post.isQuestion && isSuperuser()) insertInstantCloseButtons();

                }, 100);
            }
        });
    }


    function addReviewQueueStyles() {
        GM_addStyle(`
#footer {
    display: none !important;
}
pre {
    max-height: 320px;
}
#content {
    padding-bottom: 120px !important;
}

.suggested-edits-review-queue .review-bar .review-summary {
    flex-basis: 45%;
}
.suggested-edits-review-queue .review-bar .js-review-actions-error-target {
    flex-basis: 55%;
}

.reviewable-post .question {
    position: relative;
}

#popup-close-question {
    opacity: 0.9;
}
#popup-close-question:hover {
    opacity: 1;
}


/* Instant action buttons */
.js-review-actions-error-target button[style*='visibility'] {
    display: none;
}
.js-review-actions-error-target .js-review-actions,
.js-review-actions-error-target .instant-actions {
    display: block;
    text-align: right;
}
.js-review-actions-error-target .instant-actions {
    margin-top: 6px;
}


/* Edit reasons link to take up less space */
.popup a.edit-link {
    position: absolute;
    bottom: 25px;
    left: 25px;
}

/* Number options in popups */
.popup-pane,
.popup-subpane:not(.close-as-duplicate-pane) {
    padding-left: 14px;
}
.popup .action-list li {
    position: relative;
}
.popup .action-list .action-name {
    margin-left: 0px;
}
.popup .action-list li:before {
    position: absolute;
    top: 10px;
    left: -18px;
    font-weight: bold;
    color: #333;
}
.popup .action-list li:nth-of-type(1):before {
    content: '[1]';
}
.popup .action-list li:nth-of-type(2):before {
    content: '[2]';
}
.popup .action-list li:nth-of-type(3):before {
    content: '[3]';
}
.popup .action-list li:nth-of-type(4):before {
    content: '[4]';
}
.popup .action-list li:nth-of-type(5):before {
    content: '[5]';
}
.popup .action-list li:nth-of-type(6):before {
    content: '[6]';
}
.popup .action-list li:nth-of-type(7):before {
    content: '[7]';
}

#toasty {
    display: block;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate3d(-50%, -50%, 0);
    z-index: 999999;
    padding: 20px 30px;
    background: rgba(255,255,255,0.7) !important;
    color: black !important;
}
`);
    }


    // On page load
    loadOptions();
    doPageLoad();
    listenToPageUpdates();


})();
