(() => {
  const cfg = window.SKAITCH_SITE;
  const dict = window.SKAITCH_I18N;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // English source text, captured once so switching back needs no second copy.
  const nodes = $$('[data-i18n]');
  nodes.forEach(el => { dict.en[el.dataset.i18n] ??= el.innerHTML; });
  const ariaNodes = $$('[data-i18n-aria]');
  ariaNodes.forEach(el => { dict.en[el.dataset.i18nAria] ??= el.getAttribute('aria-label'); });
  const altNodes = $$('[data-i18n-alt]');
  altNodes.forEach(el => { dict.en[el.dataset.i18nAlt] ??= el.getAttribute('alt'); });

  let lang = 'en';
  const t = key => dict[lang][key] ?? dict.en[key] ?? key;

  // A link that is not available yet: dashed, inert, with a "soon" tag.
  const soonLinks = [];
  function soon(el) {
    el.classList.add('is-soon');
    el.removeAttribute('href');
    el.setAttribute('aria-disabled', 'true');
    soonLinks.push(el);
  }

  $$('[data-href="app"]').forEach(a => { a.href = cfg.appUrl; });

  // The build video loops on its own, except for visitors who asked for reduced motion.
  const buildVideo = $('#build-video');
  if (buildVideo && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    buildVideo.removeAttribute('autoplay');
    buildVideo.pause();
    buildVideo.controls = true;
  }

  // Desktop installers.
  const dlReady = cfg.downloads.ready;
  $('#dl-soon').hidden = dlReady;
  $$('[data-dl]').forEach(a => {
    if (dlReady) a.href = `${cfg.downloads.base}/${a.dataset.dl}`;
    else soon(a);
  });
  const releases = cfg.downloads.releasesUrl;
  if (releases && (cfg.github.public || !releases.startsWith('https://github.com/'))) {
    $('#dl-releases').hidden = false;
    $('#dl-releases a').href = cfg.downloads.releasesUrl;
  }
  $$('[data-store]').forEach(a => {
    const url = cfg.survey[a.dataset.store];
    if (url) a.href = url; else soon(a);
  });

  // Highlights the visitor's platform in the download list.
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const os = /android|iphone|ipad|ipod/i.test(ua) ? 'mobile'
    : platform.startsWith('win') ? 'windows'
    : platform.startsWith('mac') ? 'mac'
    : platform.includes('linux') ? 'linux' : null;
  if (os) $(`.platforms [data-os="${os}"]`)?.classList.add('is-mine');

  // Product documentation.
  $$('[data-doc]').forEach(a => {
    const url = cfg.docs?.[a.dataset.doc];
    const hidden = !url || (!cfg.github.public && url.startsWith('https://github.com/'));
    if (hidden) soon(a); else { a.href = url; a.rel = 'noopener'; }
  });

  // GitHub.
  const gh = $('#github');
  if (cfg.github.public) { gh.href = cfg.github.url; gh.rel = 'noopener'; } else soon(gh);

  // Videos: a poster first; the player (local file or youtube-nocookie) loads only after a click.
  const grid = $('#video-grid');
  const tpl = $('#video-card');
  const renderVideos = () => {
    grid.replaceChildren(...cfg.videos.map(v => {
      const card = tpl.content.firstElementChild.cloneNode(true);
      const title = t(`videos.${v.key}.t`);
      $('h3', card).textContent = title;
      $('p', card).textContent = t(`videos.${v.key}.d`);
      const frame = $('.frame', card);
      const play = $('.play', card);
      if (!v.youtube && !v.src) {
        play.remove();
        $('.soon', card).textContent = t('video.soon');
        card.classList.add('is-soon');
        return card;
      }
      $('.soon', card).remove();
      const id = v.youtube ? encodeURIComponent(v.youtube) : '';
      const poster = v.poster || (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
      if (poster) frame.style.backgroundImage = `url("${poster}")`;
      play.setAttribute('aria-label', `${t('video.play')} : ${title}`);
      play.addEventListener('click', () => {
        if (v.src) {
          const video = document.createElement('video');
          Object.assign(video, { src: v.src, poster, controls: true, autoplay: true, playsInline: true });
          video.setAttribute('aria-label', title);
          frame.replaceChildren(video);
          return;
        }
        const iframe = document.createElement('iframe');
        iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
        iframe.title = title;
        iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        iframe.allowFullscreen = true;
        frame.replaceChildren(iframe);
      });
      return card;
    }));
  };

  function apply(next) {
    lang = next;
    document.documentElement.lang = lang;
    nodes.forEach(el => { el.innerHTML = t(el.dataset.i18n); });
    // aria-label and alt are plain text: decode the entities used in the translations.
    const plain = html => { const d = document.createElement('textarea'); d.innerHTML = html; return d.value; };
    ariaNodes.forEach(el => { el.setAttribute('aria-label', plain(t(el.dataset.i18nAria))); });
    altNodes.forEach(el => { el.setAttribute('alt', plain(t(el.dataset.i18nAlt))); });
    soonLinks.forEach(el => { el.dataset.soon = t('soon'); });
    $('#github-label').textContent = t(cfg.github.public ? 'github.open' : 'github.soon');
    const switcher = $('#lang');
    switcher.textContent = lang === 'en' ? 'FR' : 'EN';
    switcher.setAttribute('aria-label', t('lang.switch'));
    renderVideos();
    try { localStorage.setItem('skaitch-site-lang', lang); } catch {}
  }

  let saved = null;
  try { saved = localStorage.getItem('skaitch-site-lang'); } catch {}
  // English by default; French only when the visitor chose it.
  const initial = saved === 'fr' ? 'fr' : 'en';
  $('#lang').addEventListener('click', () => apply(lang === 'en' ? 'fr' : 'en'));
  apply(initial);
})();
