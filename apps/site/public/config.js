// Site settings: the only file to edit when a link, a download or a video becomes available.
window.SKAITCH_SITE = {
  // Online editor.
  appUrl: 'https://app.skaitch.online/',

  // GitHub repository. Leave `public: false` while the repository is private:
  // the link then shows as "coming soon".
  github: { public: false, url: 'https://github.com/skaitch/skaitch' },

  // Desktop installers, served by the editor's /download/:platform endpoint
  // (latest GitHub release). Set `ready: true` once a release is published and the
  // endpoint answers with a redirect instead of 503.
  downloads: {
    ready: true,
    base: 'https://app.skaitch.online/download',
    // Release page shown under the buttons; hidden while the GitHub repository is private.
    releasesUrl: 'https://github.com/skaitch/skaitch/releases/latest',
  },

  // Documentation of each product. An empty link shows as "coming soon"; GitHub links
  // also stay "coming soon" while the repository is private.
  docs: {
    online: 'https://github.com/skaitch/skaitch#readme',
    app: 'https://github.com/skaitch/skaitch/tree/main/apps/desktop#readme',
    survey: 'https://github.com/skaitch/skaitch/tree/main/apps/survey#readme',
  },

  // skAItch Survey mobile app. Fill a store or APK link to show its button.
  // Android: the APK of the latest release, through the same /download endpoint.
  survey: { android: 'https://app.skaitch.online/download/android', ios: '' },

  // Demo videos. Either `src` (a file under public/, with a `poster` image) or `youtube`
  // (the video ID, the part after "v="); neither shows a "coming soon" card.
  // Titles and texts live in i18n.js (videos.<key>.*).
  videos: [
    { key: 'tour', src: 'media/videos/tour.mp4', poster: 'media/videos/tour.jpg' },
    { key: 'planToIfc', src: 'media/videos/plan-to-ifc.mp4', poster: 'media/videos/plan-to-ifc.jpg' },
    { key: 'mcp', src: 'media/videos/mcp.mp4', poster: 'media/videos/mcp.jpg' },
    { key: 'survey', src: 'media/videos/survey.mp4', poster: 'media/videos/survey.jpg' },
  ],
};
