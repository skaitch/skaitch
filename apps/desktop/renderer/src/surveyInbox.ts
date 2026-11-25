import type { ReceivedSurvey, SurveyInbox } from '@skaitch/ui/platform';

/** Desktop side of the survey inbox: surveys sent from the phone on the local network. */
export const desktopSurveyInbox: SurveyInbox = {
  list: () => window.skaitchDesktop.survey.list(),
  async download(survey: ReceivedSurvey) {
    const file = new Uint8Array(survey.bytes);
    let at = 0;
    for (let index = 0; at < survey.bytes; index++) {
      const b64 = await window.skaitchDesktop.survey.readChunk(survey.id, index);
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      if (!bytes.length) break;
      file.set(bytes, at);
      at += bytes.length;
    }
    return file.subarray(0, at);
  },
  remove: id => window.skaitchDesktop.survey.remove(id),
  listKeys: () => window.skaitchDesktop.survey.keys(),
  createKey: name => window.skaitchDesktop.survey.createKey(name),
  revokeKey: id => window.skaitchDesktop.survey.revokeKey(id),
};
