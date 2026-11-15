import { dateKey } from './household-model.js';

// Original encouragement written for the house; no invented famous attributions.
const quotes = [
  'Small steps still move you forward.',
  'Make a little room for the things that make you feel alive.',
  'A good day can begin again at any moment.',
  'You do not have to do everything to do something meaningful.',
  'Let today be a little kinder than it needs to be.',
  'Ordinary moments are where a good life happens.',
  'Rest is part of the rhythm, too.',
  'Start where you are. Bring a little curiosity.',
  'Progress can be quiet and still be real.',
  'A small kindness can change the shape of a day.',
  'There is something worth noticing in every ordinary day.',
  'Make a plan. Leave room for a little wonder.',
  'You can move slowly and still arrive.',
  'The time you give each other is part of what makes a home.'
];
const facts = [
  'Octopuses have three hearts and blue blood.',
  'Venus takes longer to rotate once on its axis than to orbit the Sun.',
  'Bananas are botanically classified as berries.',
  'Butterflies have taste sensors on their feet.',
  'The dot over a lowercase i or j is called a tittle.',
  'A day on Mars lasts about 24 hours and 39 minutes.',
  'The Moon moves about 3.8 centimeters farther from Earth each year.',
  'Honeybees use a waggle dance to communicate the location of food.',
  'The Eiffel Tower expands slightly in hot weather as its metal warms.',
  'Sound travels about four times faster in water than in air.',
  'Sea otters have loose skin under their forelegs that they use to carry food.',
  'Penguins use their wings as flippers to move through water.',
  'Earth’s atmosphere scatters blue light more strongly than red light, making the daytime sky look blue.',
  'A rainbow is a full circle; the ground usually hides the bottom half from view.'
];
const words = [
  ['serendipity','noun','Finding something good when you weren’t looking for it.','Finding our favorite café was pure serendipity.'],
  ['petrichor','noun','The pleasant smell after rain falls on dry ground.','The open window let in the petrichor.'],
  ['respite','noun','A short period of rest or relief.','A quiet cup of tea offered a welcome respite.'],
  ['convivial','adjective','Friendly, lively, and enjoyable.','It was a convivial dinner around a crowded table.'],
  ['gumption','noun','Practical initiative, courage, and resourcefulness.','A little gumption got the project moving.'],
  ['mellifluous','adjective','Smooth and pleasant to hear.','Her mellifluous voice filled the kitchen.'],
  ['halcyon','adjective','Calm, peaceful, and happy.','We remembered the halcyon days by the lake.'],
  ['amble','verb','To walk at a relaxed, unhurried pace.','Let’s amble around the neighborhood.'],
  ['solace','noun','Comfort in a difficult or disappointing moment.','He found solace in a familiar song.'],
  ['verdant','adjective','Green with growing plants.','The trail wound through a verdant valley.'],
  ['kindred','adjective','Similar in nature or character.','They recognized each other as kindred spirits.'],
  ['apricity','noun','The warmth of the sun in winter.','The cat settled into a patch of apricity.'],
  ['effervescent','adjective','Lively, enthusiastic, and full of energy.','Her effervescent laugh brightened the room.'],
  ['liminal','adjective','At a boundary or between two stages.','Dawn is a liminal moment between night and day.']
];
const jokes = [
  ['Why was the broom late?', 'It overswept.'],
  ['What did one wall say to the other?', 'I’ll meet you at the corner.'],
  ['Why did the bicycle take a nap?', 'It was two-tired.'],
  ['What do you call a cat who loves bowling?', 'An alley cat.'],
  ['Why don’t eggs tell jokes?', 'They’d crack each other up.'],
  ['What do you call a bear with no teeth?', 'A gummy bear.'],
  ['Why did the tomato blush?', 'It saw the salad dressing.'],
  ['How does a penguin build a house?', 'Igloos it together.'],
  ['What do you call a sleeping dinosaur?', 'A dino-snore.'],
  ['Why did the cookie go to the doctor?', 'It felt crummy.'],
  ['What kind of music do balloons dislike?', 'Pop music.'],
  ['What did the ocean say to the beach?', 'Nothing. It just waved.'],
  ['Why did the calendar need a break?', 'Its days were numbered.'],
  ['What do cats eat for breakfast?', 'Mice Krispies.']
];
const missions = [
  'Put five little things back where they belong.',
  'Tell someone one specific thing you appreciate about them.',
  'Give one small surface a two-minute reset.',
  'Stretch, take a breath, and look away from the screen.',
  'Put on a favorite song and enjoy it all the way through.',
  'Find one thing at home that makes you smile.',
  'Open a book and read just one page.'
];
export function dailyContent(now = new Date()) {
  const key = dateKey(now);
  const ordinal = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  const index = ((ordinal % 14) + 14) % 14;
  const [word, part, definition, example] = words[index];
  return { key, quote: quotes[index], attribution: 'Hubert’s House', fact: facts[index], word: { word, part, definition, example }, joke: { setup: jokes[index][0], punchline: jokes[index][1] }, mission: missions[index % missions.length] };
}
