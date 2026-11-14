// Pure draft mapper for Google Calendar V1. No network requests or credentials.
// CommonJS for the existing Node test runner.
(function (root) {
  'use strict';
  function nextDay(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function eventForTask(task) {
    if (!task || task.erledigt || !task.faellig) return null;
    var summary = task.titel + (task.zustaendig ? ' · ' + task.zustaendig : '');
    if (!task.uhrzeit) {
      return { summary: summary, start: { date: task.faellig },
        end: { date: nextDay(task.faellig) }, reminders: { useDefault: true } };
    }
    if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(task.uhrzeit)) throw new Error('Invalid time');
    // Google accepts local dateTime with an IANA timeZone; 30 minutes duration
    // is calculated by the backend with DST-aware timezone handling, not here.
    return { summary: summary, start: { dateTime: task.faellig + 'T' + task.uhrzeit + ':00', timeZone: 'Europe/Berlin' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] } };
  }
  var api = { eventForTask: eventForTask, nextDay: nextDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalendarDraft = api;
})(typeof window !== 'undefined' ? window : this);
