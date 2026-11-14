// ══════════════════════════════════════════════════════════════
//  Вимова слів івритом: натиснути на слово — і почути, як воно звучить.
//
//  Говорить сам телефон чи комп'ютер (голос івриту, вбудований у пристрій).
//  Працює для давньоєврейських слів у статтях (позначені класом .heb)
//  і для елементів з атрибутом data-speak. Підказку з атрибутом
//  data-he-hint показує лише там, де пристрій уміє говорити.
// ══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') return;
    var synth = window.speechSynthesis;
    var TARGET = '.article-body .heb, .modal-title .heb, .content .heb, h1 .heb, [data-speak]';
    var uk = /^uk/i.test(document.documentElement.lang || 'uk');
    var TEXT = {
        title: uk ? 'Натисніть, щоб почути' : 'Tap to hear',
        noVoice: uk
            ? 'На цьому пристрої немає голосу для івриту. Його можна додати в налаштуваннях: «Мова» → «Синтез мовлення» (Android) або «Мовлений вміст» (iPhone).'
            : 'This device has no Hebrew voice. You can add one in the system speech (text-to-speech) settings.'
    };

    var style = document.createElement('style');
    style.textContent =
        '.article-body .heb,.modal-title .heb,.content .heb,h1 .heb,[data-speak]{cursor:pointer;border-radius:2px;transition:background .2s;}' +
        '.article-body .heb,.content .heb{border-bottom:1px dotted rgba(138,107,42,0.6);}' +
        '.article-body .heb:hover,.modal-title .heb:hover,.content .heb:hover,h1 .heb:hover,[data-speak]:hover{background:rgba(201,168,76,0.18);}' +
        '.he-speaking{background:rgba(201,168,76,0.38)!important;}' +
        '.he-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:3000;max-width:min(92vw,520px);' +
        'background:#1a1208;color:#fdf5e6;border:1px solid #c9a84c;padding:12px 16px;font:1rem/1.45 Georgia,serif;box-shadow:0 10px 30px rgba(0,0,0,.5);}' +
        '@media print{.article-body .heb,.content .heb{border-bottom:0;}}';
    document.head.appendChild(style);

    function hebrewVoice() {
        var list = synth.getVoices() || [];
        for (var i = 0; i < list.length; i++) if (/^(he|iw)([-_]|$)/i.test(list[i].lang)) return list[i];
        return list.length ? false : null;   // false — голосів багато, але івриту немає; null — список ще не завантажено
    }
    synth.getVoices();   // деякі браузери завантажують голоси лише після першого запиту

    var toastTimer = 0;
    function toast(text) {
        var box = document.querySelector('.he-toast');
        if (!box) {
            box = document.createElement('div');
            box.className = 'he-toast';
            box.setAttribute('role', 'status');
            document.body.appendChild(box);
        }
        box.textContent = text;
        box.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { box.hidden = true; }, 7000);
    }

    var speaking = null;
    function stop() {
        if (speaking) speaking.classList.remove('he-speaking');
        speaking = null;
    }
    function say(el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return;
        var voice = hebrewVoice();
        if (voice === false) { toast(TEXT.noVoice); return; }
        synth.cancel();
        stop();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'he-IL';
        if (voice) u.voice = voice;
        u.rate = 0.8;
        u.onend = u.onerror = function () { if (speaking === el) stop(); };
        speaking = el;
        el.classList.add('he-speaking');
        synth.speak(u);
    }

    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest(TARGET) : null;
        if (!el || el.closest('a, button, input, textarea, select')) return;
        var sel = window.getSelection && window.getSelection();
        if (sel && String(sel).trim()) return;   // людина виділяє текст, а не слухає
        say(el);
    });
    document.addEventListener('mouseover', function (e) {
        var el = e.target && e.target.closest ? e.target.closest(TARGET) : null;
        if (el && !el.title && !el.closest('a, button')) el.title = TEXT.title;
    });

    function showHints() {
        var hints = document.querySelectorAll('[data-he-hint]');
        for (var i = 0; i < hints.length; i++) hints[i].hidden = false;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showHints);
    else showHints();
})();
