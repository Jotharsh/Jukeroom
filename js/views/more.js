import { h, icon } from '../ui.js';

const page = (screen, title, ...body) => screen.replaceChildren(
  h('header', { class: 'topbar' }, h('a', { class: 'iconbtn', href: '#/', 'aria-label': 'Back' }, icon('back')), h('span', { class: 'brand' }, title)),
  h('article', { class: 'prose' }, ...body));

export function help(screen) {
  page(screen, 'How it works',
    h('h1', {}, 'A listening room in your pocket'),
    h('p', {}, 'One person starts a room and becomes the host. Everyone else joins with the 6-character code or the invite link. Each device plays the same YouTube song itself, and Jukeroom keeps them within a fraction of a second of each other.'),
    h('h2', {}, 'Using it'),
    h('ol', {},
      h('li', {}, 'Tap Start a room, give it a name, and add a password if you want one.'),
      h('li', {}, 'Share the invite link or the code. People type their name, then the password if there is one.'),
      h('li', {}, 'Paste YouTube links to add songs. The first one starts straight away, the rest queue up.'),
      h('li', {}, 'Use Play, Pause, Next and the timeline. The host can switch off controls for guests from the menu.')),
    h('h2', {}, 'Good to know'),
    h('ul', {},
      h('li', {}, 'The room lives on the host\'s device. If the host closes the page, the room ends. If they only refresh it, guests reconnect on their own.'),
      h('li', {}, 'Phones and laptops can both host and join. On an iPhone, tap the screen once if the music does not start by itself.'),
      h('li', {}, 'Keep the screen on. Browsers often pause video when a phone locks or the app goes to the background.'),
      h('li', {}, 'Devices stay within about a quarter of a second of each other. The SYNC light shows the current gap on your device.'),
      h('li', {}, 'Some videos cannot be played outside YouTube. Jukeroom skips those and says so.'),
      h('li', {}, 'Rooms are made for friends and small groups, up to 12 people. On some mobile networks a direct connection is not possible and a guest may not be able to join.')),
    h('h2', {}, 'About the password'),
    h('p', {}, 'The host\'s device checks the password and never sends it to guests. It keeps people out who do not know it. It is not bank-grade security, so do not reuse a real password.'),
    h('p', {}, h('a', { class: 'btn primary', href: '#/' }, 'Start listening')));
}

export function privacy(screen) {
  page(screen, 'Privacy',
    h('h1', {}, 'Privacy'),
    h('p', {}, 'Jukeroom has no server of its own and no accounts. We do not collect, store or sell anything.'),
    h('h2', {}, 'What other people can see'),
    h('ul', {},
      h('li', {}, 'Your nickname, and the songs you add, are visible to everyone in the room.'),
      h('li', {}, 'Devices in a room connect directly to each other (WebRTC). That means the host and guests can technically see each other\'s network address (IP). Only join rooms of people you trust.')),
    h('h2', {}, 'Third parties'),
    h('ul', {},
      h('li', {}, 'PeerJS\'s free public broker introduces devices to each other when they connect. It sees connection details, not your music or messages.'),
      h('li', {}, 'Songs play through YouTube\'s own embedded player, so YouTube sees the video being watched, as it does on any site that embeds it. Song titles come from YouTube too.')),
    h('h2', {}, 'On your device'),
    h('p', {}, 'Your nickname, volume, recent room codes and, if you host, the room details (including its password) are kept in this browser so a refresh does not lose them. Ending a room clears the host details.'),
    h('p', {}, 'Jukeroom does not store or copy any music. It only tells each device which YouTube video to play and when.'));
}
