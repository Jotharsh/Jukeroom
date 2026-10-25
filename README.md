# Jukeroom

Listen to YouTube songs together, in sync. Start a room (with a password if you like), share the code, and everyone adds songs to the same queue. Works on phones and laptops, installs to the home screen, free to run, no account.

Live: https://jotharsh.github.io/Jukeroom/

## How it works
- **No server of ours.** The host's browser is the room. It keeps the queue and the playback state and checks the password. Guests connect straight to it over WebRTC (via [PeerJS](https://peerjs.com)'s free public broker, which only introduces the devices).
- **Nothing is streamed.** Each device plays the song itself through YouTube's embedded player. The room only shares small messages such as "this video, at this moment".
- **Sync.** Guests measure the host's clock with ping/pong round trips (best of the quickest samples), work out where the song should be, and seek if they drift more than 0.7 s. The SYNC light shows the measured gap on that device.
- **Refresh safe.** The host's room (code, password, queue) is kept in the browser, so a refresh brings the same room back and guests reconnect on their own.

## Limits (honest)
- The room ends when the host closes the page.
- Up to 12 people per room. Free STUN only, so on some mobile networks a direct connection is impossible and a guest cannot join.
- Browsers may pause video when a phone locks. iPhone needs one tap to start sound.
- The password is checked on the host's device. It keeps friends out; it is not strong security.
- Videos with embedding turned off are skipped. There is no search, you paste links.
- Participants can see each other's IP address (a property of WebRTC).

## Run
No build step: serve the folder with any static server, e.g. `npx serve .`. Open it in two browsers (one in a private window) to try a room.

## Test
`node --test test/` covers the room rules, passwords, clock sync, drift decisions and link parsing. The end-to-end run (two real browsers, real WebRTC and YouTube) used puppeteer-core and is not part of the repo.

## Credits
Set in Space Grotesk and Share Tech Mono (SIL OFL, files in `fonts/`). PeerJS is MIT licensed (`vendor/`). MIT licensed.
