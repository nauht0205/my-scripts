# my-scripts

Userscripts (Tampermonkey / Violentmonkey). Each one updates itself from this repository.

| Script | Install link |
|---|---|
| VTO Auto Accept (Mac) | [mac/vto-auto-accept.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/mac/vto-auto-accept.user.js) |
| VTO Phone Alerts (Mac) | [mac/vto-phone-alerts.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/mac/vto-phone-alerts.user.js) |
| VTO Auto Accept (PC) | [pc/vto-auto-accept.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/pc/vto-auto-accept.user.js) |
| VTO Phone Alerts (PC) | [pc/vto-phone-alerts.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/pc/vto-phone-alerts.user.js) |
| Transfer Schedule | [transfer-schedule.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/transfer-schedule.user.js) |
| Stretch Fullscreen Video (car head unit, Violentmonkey in Firefox) | [head-unit/stretch-fullscreen-video.user.js](https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/stretch-fullscreen-video.user.js) |

No keys are stored here. Pushover keys live in Tampermonkey on each computer.

## Head unit MacroDroid macros

Import in MacroDroid: AI Macro Builder > Use Externally > paste the JSON response.

- [head-unit/macrodroid-audio-switch.json](https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/macrodroid-audio-switch.json): AUDIO button flips Firefox and CarPlay, then taps to restore fullscreen.
- [head-unit/macrodroid-fullscreen-tap.json](https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/macrodroid-fullscreen-tap.json): taps the screen when the script shows "Going fullscreen".
- [head-unit/macrodroid-fullscreen-keeper.json](https://raw.githubusercontent.com/nauht0205/my-scripts/main/head-unit/macrodroid-fullscreen-keeper.json): NEW. Every time Firefox comes to the front, taps the screen while the YouTube address bar is showing, until the video is fullscreen.
