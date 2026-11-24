import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { exportedNames } from './exported-names.js';
process.env.TZ = 'America/New_York';
const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');
const clean = source => source.replace(/^export \{[^}]*\} from [^;]+;$/gm,'').replace(/^import\b[\s\S]*?;\s*$/gm,'').replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|let))/g,'');
const settle = () => new Promise(r => setTimeout(r,30));
async function fixture(options = {}) {
  const errors=[]; const console=new VirtualConsole(); console.on('jsdomError',e => errors.push(e));
  const dom=new JSDOM(await read('index.html'),{url:options.live ? 'https://house.example/' : 'https://house.example/?demo=1',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
  const w=dom.window;
  w.structuredClone=structuredClone; w.confirm=() => true; w.alert=message => {throw new Error(message);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;}; w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  Object.assign(w,{config:{firebase:{},calendarServiceEnabled:false},initializeApp:() => ({}),getFirestore:() => ({}),collection:() => ({}),getAuth:() => ({}),onAuthStateChanged:(_auth,callback) => callback({uid:'nonmember',email:'outsider@example.com'}),getDoc:async () => ({exists:() => false}),setDoc:async () => {},doc:(...args) => args,signOut:async () => {},serverTimestamp:() => new Date(),getFunctions:() => ({}),httpsCallable:() => {throw new Error('Demo must not call the calendar service');}});
  // Real FullCalendar is exercised in a DOM. This is not a visual browser test.
  w.eval(await read('node_modules/fullcalendar/index.global.js'));
  // Every export becomes a global for the modules loaded after it (the list in each call is just documentation).
  async function module(file,names = [],extra='') { const source = await read(file), all = [...new Set([...names, ...exportedNames(source)])]; w.eval(`(() => { ${extra}\n${clean(source)}\nObject.assign(window,{${all.join(',')}}); })();`); }
  await module('household-model.js',['dateKey','dueLabel','completionPatch','validateItem','escapeHTML','OWNERS','CATEGORIES','filterTaskItems','guessAisle']);
  await module('calendar-model.js',['localDate','startOfDay','nextDay','eventEnd','eventsOnDay','checklistProgress']);
  await module('dom.js',['renderHTML']);
  await module('jokes.js',['dadJokes','afterDarkJokes','dailyJokes']);
  await module('daily-content.js',['dailyContent']);
  await module('holidays.js',['usHolidays','holidaysInRange','holidaysEnabled','holidayEvents']);
  await module('event-data.js',[]);
  await module('cat-mode.js',[]);
  await module('stores.js',[]);
  await module('checklist-ui.js',[]);
  await module('panels.js',[]);
  await module('time-dial.js',['initTimeDial','minutesAt','startFrom','endFrom']);
  await module('event-editor.js',['initEventDateEditor','eventRangeSummary']);
  await module('event-planning.js',['overlappingEvents','preferredCalendar']);
  await module('cat-crew.js',['initCatCrew','cats','portrait']);
  await module('dashboard.js',['initDashboard']);
  await module('event-templates.js',['eventTemplate']);
  await module('demo.js',['demoStore','demoEvents','demoMealStore','demoBogos']);
  if (options.failItemUpdate) {
    const originalStore = w.demoStore;
    w.demoStore = () => ({ ...originalStore(), update: async () => { throw new Error('The connection interrupted this save.'); } });
  }
  await module('checklists.js',['checklistKey','eventChecklistKey','eventChecklistGroups']);
  await module('household.js',['initHousehold','updateHouseholdEvents','showNotice','showView','householdItems','addHouseholdItems'],'const esc=escapeHTML;');
  await module('cloud-calendar.js',['initCloudCalendar','setCloudRange','refreshCloud','saveCloudEvent','saveCloudAssignment','deleteCloudEvent'],'const esc=escapeHTML;');
  await module('baby-history.js',['toOunces','localDay','dayStart','dayKeys','sleepKind','dayStory','dayStoryText','nightLine','clockAt','DEFAULT_NIGHT_LINE','dailySleep','dailyBottles', 'dailyPumps','timelineRows','babySummary']);
  await module('day-strip.js',['stripRange','dayStripSVG','STRIP_LANES','CATS'],'const esc=escapeHTML;');
  await module('baby-model.js',['purrfectWindow','huckleberryPrediction','miaForecast','indexedWakeWindows','bottleForecast','correlation','ageInDays','ageLabel','halfLifeFor','typicalWindow','bottleSleepLinks','catsConsensus','averageCalls','sleepAwareBottle']);
  await module('mia-v1.js',['miaForecastV1']);
  await module('cat-challenges.js',['CHALLENGES','MACK_EXCUSE','nightsFrom','currentBedtime','morningPicks','bottlePicks','scoreMornings','scoreBottles', 'scorePumps', 'pumpPicks','napNightPicks','nextSleepKind','scoreNapNight']);
  await module('prediction-log.js',['MODELS','predictionId','isDaytimeWake','sweetspotEntry','sweetspotPatch','previousSweetspot','actualSleepStart','replayGuesses','scorePredictions','MIA_V2_SINCE','miaVersionAt','recoveredEntry','guessRounds']);
  await module('baby-sample.js',['sampleHistory','samplePredictions']);
  await module('awards.js',['frankieAwards']);
  await module('bottle-pace.js',['bottlePace']);
  await module('mack-hat.js',['seeded','HAT_LINES','hatGuess','hatSeed','scoreHat']);
  await module('day-ring.js',['dayRing','dayRingHTML']);
  await module('frankie.js',['renderFrankie','initFrankie','frankieDayText','bottleLinksHTML', 'pumpsHTML', 'paceHTML','challengeHTML','napNightHTML','hatHTML','callsSlides'],'const esc=escapeHTML;');
  await module('baby-logs.js',['LOG_FILTERS','describeLog','logKey','logsHTML'],'const esc=escapeHTML;');
  await module('baby.js',['initHuckleberry','logBabyFromText'],'const esc=escapeHTML;');
  await module('calendar-view.js',['initCalendarExperience','calendarEventContent'],'const esc=escapeHTML;');
  await module('weather-shared.js',['richmondDay','forecastCondition','weatherIcon']);
  await module('birthdays-model.js',['birthdayList','setBirthdayList','birthdaysShown','birthdayTitle','birthdaysInRange','birthdayEvents','upcomingBirthdays']);
  await module('place-weather.js',['looksLocal','distanceKm','placeQueries','describeCode','createPlaceWeather','placeWeatherText','usePlaceWeather','eventWeatherLine','sampleWeatherFetch','placeSuggestions','searchPlaces','whereBoxText','shortPlace']);
  await module('place-suggest.js',['pastMatches','townQuery','initPlaceSuggest'],'const esc=escapeHTML;');
  await module('home-calendar.js',['initHomeCalendar','homeCalendarWeek','dayWeather','WEATHER_URL'],'const esc=escapeHTML;');
  await module('weather.js',['initWeather'],'const esc=escapeHTML;');
  await module('week-brief.js',['renderWeekBrief'],'const esc=escapeHTML;');
  await module('quick-add.js',['parseQuickAdd','describeDraft','parseBabyLog','describeBabyLog']);
  await module('smart-home.js',['isOutdoor','weatherFlags','nextUp','untilText']);
  await module('free-nights.js',['freeEvenings','dateNightDraft']);
  await module('sky.js',['skyState','skyArt']);
  await module('upgrades.js',['initUpgrades'],'const esc=escapeHTML;');
  await module('newsletter-settings.js',['initNewsletterSettings','lastTestNote'],'const esc=escapeHTML;');
  await module('siri-settings.js',['initSiriSettings','shortcutSteps'],'const esc=escapeHTML;');
  await module('briefing-format.js',['marketValue','marketChange','marketDate','marketLine']);
  await module('world-view.js',['RANGES','briefingHTML','rangePoints','rangeChange','shortValue','fullValue','dateLabel','chartSVG','chartPanelHTML','sampleMarketHistory','sampleBriefing'],'const esc=escapeHTML;');
  await module('world-briefing.js',['initWorldBriefing']);
  await module('install-app.js',['detectDevice','STEPS','weblocFile','installHTML','initInstall'],'const esc=escapeHTML;');
  await module('devices-view.js',['DEVICE_APPS','appStoreSearch','safeDeviceLink','readDeviceLinks','deviceTiles','launcherHTML','hueHTML','sonosHTML','DEVICE_SETUP','deviceSettingsHTML','readConnectResult','stripConnectParams','sampleHue','sampleSonos','sampleDeviceStatus'],'const esc=escapeHTML;');
  await module('devices.js',['initDevices']);
  await module('litter-view.js',['litterHeadline','litterHTML','litterSettingsHTML','sampleLitter'],'const esc=escapeHTML;');
  await module('litter.js',['initLitter']);
  await module('feeders-view.js',['feederAlerts','feedersHTML','FEEDER_STEPS','feederSettingsHTML','sampleFeeders'],'const esc=escapeHTML;');
  await module('feeders.js',['initFeeders']);
  await module('meal-recipes.js',['RECIPES']);
  await module('meal-ideas.js',['IDEAS','STAPLES','norm','dealFor','onList','annotate','suggestMeals','weekPlan','groceryItemsFor','parseIngredients','validateMeal','dinnerBogos','recipeFor','parseSteps']);
  await module('meals-view.js',['planHTML','ideasHTML','bogosHTML','storesHTML','favoritesHTML','recipeHTML'],'const esc=escapeHTML;');
  await module('meals.js',['initMeals']);
  await module('pull-refresh.js',['PULL_READY','PULL_MAX','pullDistance','isStandalone','initPullRefresh']);
  await module('bath-days.js',['DEFAULT_BATH_DAYS','WEEKDAYS','BATH_TITLE','cleanBathDays','bathDays','setBathDays','isBathDay','describeBathDays','bathDaysInRange','bathEvents','nextBathDay']);
  await module('hypotheses.js',['FACTORS','OUTCOMES','fits','describeHypothesis','parseHypothesis','hypothesisData','formatOutcome','testHypothesis','claudeDigest']);
  await module('hypotheses-view.js',['memoryHypotheses','initHypotheses'],'const esc=escapeHTML;');
  await module('service-health-model.js',[]);
  await module('health-view.js',[],'const esc=escapeHTML;');
  await module('trash-days.js',['DEFAULT_TRASH','PICKUP_LOOK','keyOf','bigHolidays','holidayOn','cleanTrash','trashSettings','setTrash','pickupsInRange','pickupTitle','trashEvents','pickupOn','nextPickup','describeTrash']);
  await module('trash-settings.js',['trashPanelHTML','memoryTrashStore','initTrashDays'],'const esc=escapeHTML;');
  await module('bath-settings.js',['bathPanelHTML','memoryBathStore','initBathDays'],'const esc=escapeHTML;');
  await module('birthdays.js',['sampleBirthdays','birthdayPanelHTML','initBirthdays'],'const esc=escapeHTML;');
  w.eval(clean(await read('app.js')) + ';window.__testApp={getDocs:()=>rawDocs,setCloudDocs:(records)=>{cloudDocs=records;rebuildEvents();},persistMovedEvent,redraw:()=>updateHouseholdEvents(expandedEvents)};'); await settle();
  return {dom,w,doc:w.document,errors};
}
test('home views, theme and monitor navigation work together without hiding the daily extras', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('themeToggle').click(); assert.equal(doc.documentElement.dataset.theme,'dark'); assert.equal(w.localStorage.getItem('hh_theme'),'dark');
  doc.querySelector('[data-home-view="month"]').click(); assert.equal(doc.querySelectorAll('.home-week-day').length,42);
  assert.equal(new Set([...doc.querySelectorAll('.home-week-day')].map(el => el.dataset.homeDate)).size,42);
  doc.querySelector('[data-home-view="day"]').click(); assert.equal(doc.querySelectorAll('.home-week-day').length,1);
  doc.querySelector('[data-home-view="week"]').click(); assert.equal(doc.querySelectorAll('.home-week-day').length,7);
  doc.querySelector('[data-life-tab="todos"]').click(); doc.getElementById('displayBtn').click(); await settle();
  assert.equal(doc.body.classList.contains('monitor-mode'),true); assert.equal(doc.getElementById('view-life').classList.contains('hidden'),false); assert.equal(doc.getElementById('life-todos').hidden,false);
  doc.dispatchEvent(new w.Event('visibilitychange')); await settle(); assert.equal(doc.getElementById('view-life').classList.contains('hidden'),false); assert.equal(doc.getElementById('life-todos').hidden,false);
  doc.querySelector('[data-view="today"]').click();
  for (const id of ['dailyQuote','dailyFact','dailyWord','dailyJoke','catCrew','babyStats']) assert.ok(doc.getElementById(id));
  assert.match(doc.getElementById('dailyWordSay').textContent, /^\/[a-z-]*[A-Z]{2,}[a-zA-Z-]*\/$/, 'the word of the day shows how to say it');
  assert.deepEqual(errors,[]);
});
test('Frankie stays paired with an adult and is preserved when opening an event again', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('quickEvent').click(); doc.getElementById('evtTitle').value='Frankie comes along';
  doc.getElementById('evtOwner').value='hanry'; doc.getElementById('evtOwner').dispatchEvent(new w.Event('change')); doc.getElementById('evtWithFrankie').checked=true;
  doc.getElementById('saveBtnTop').click(); await settle();
  const record = w.__testApp.getDocs().find(d => d.title === 'Frankie comes along'); assert.equal(record.withFrankie,true); assert.equal(record.owner,'hanry');
  const card=doc.querySelector(`#homeWeek [data-home-event="${record.id}"]`); assert.ok(card.classList.contains('with-frankie')); card.click();
  assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),false);
  assert.equal(doc.getElementById('evtOwner').value,'hanry'); assert.equal(doc.getElementById('evtWithFrankie').checked,true);
  doc.getElementById('evtOwner').value='custom'; doc.getElementById('evtOwner').dispatchEvent(new w.Event('change'));
  assert.equal(doc.getElementById('evtWithFrankie').disabled,true); assert.equal(doc.getElementById('evtWithFrankie').checked,false);
  assert.deepEqual(errors,[]);
});
test('sample baby logs support bottles, diapers and sleep without calling a connected service', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-baby-log="bottle"]').click(); assert.equal(doc.getElementById('babyLogDialog').open,true);
  doc.getElementById('babyLogAmount').value='5'; doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit',{cancelable:true})); await settle();
  assert.equal(doc.getElementById('babyLogDialog').open,false); assert.match(doc.getElementById('babyStats').textContent,/5 oz/);
  doc.querySelector('[data-baby-log="diaper"]').click(); doc.getElementById('babyLogDiaper').value='poo'; doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit',{cancelable:true})); await settle();
  assert.match(doc.getElementById('babyStats').textContent,/Dirty/);
  doc.getElementById('babySleep').click(); await settle(); assert.match(doc.getElementById('babySleep').textContent,/Finish sleep/); assert.match(doc.getElementById('babyPredictions').textContent,/🎩 \d{1,2}:\d\d [AP]M.*Out of the hat.*not in the competition/s, 'SweetSpot is quiet while she sleeps, so Mack pulls one from the hat');
  doc.getElementById('babySleep').click(); await settle(); assert.match(doc.getElementById('babySleep').textContent,/Start sleep/);
  assert.deepEqual(errors,[]);
});
test('clicking a read-only iCloud event opens editable household assignments while protecting Apple fields', async t => {
  const {dom,w,doc,errors}=await fixture();t.after(()=>dom.window.close());
  const start=new Date();start.setHours(9,0,0,0);const end=new Date(+start+3600000),saved=[];
  w.__testApp.setCloudDocs([{id:'cloud-event',uid:'apple-uid',token:'resource',calendarId:'shared',calendarName:'Shared calendar',title:'Shared appointment',start:start.toISOString(),end:end.toISOString(),cloudEnd:end.toISOString(),allDay:false,owner:'both',ownerCustom:'',withFrankie:false,assignmentVersion:2,icloud:true,readOnlyReason:'This Apple calendar is read-only.'}]);
  w.saveCloudAssignment=async(assignment,original)=>{saved.push({assignment,original});return {saved:true};};
  w.saveCloudEvent=async()=>{throw new Error('Owner changes must not write to Apple.');};
  doc.querySelector('#homeWeek [data-home-event="cloud-event"]').click();
  assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),false);assert.equal(doc.getElementById('evtCalendar').value,'shared');
  assert.equal(doc.getElementById('evtTitle').disabled,true);assert.equal(doc.getElementById('evtStartDate').disabled,true);assert.equal(doc.getElementById('evtOwner').disabled,false);
  doc.getElementById('evtOwner').value='karena';doc.getElementById('evtWithFrankie').checked=true;doc.getElementById('saveBtnTop').click();await settle();
  assert.equal(saved.length,1);assert.equal(saved[0].assignment.owner,'karena');assert.equal(saved[0].assignment.withFrankie,true);assert.equal(saved[0].original.assignmentVersion,2);
  assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),true);assert.deepEqual(errors,[]);
});
test('sample preview keeps data isolated and supports navigation, grocery editing and recurring chore undo', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  assert.ok(doc.getElementById('gate').classList.contains('hidden'));
  assert.ok(!doc.getElementById('demoBanner').classList.contains('hidden'));
  assert.equal(doc.getElementById('statGroceries').textContent,'5');
  doc.querySelector('[data-life-tab="groceries"]').click();
  assert.ok(!doc.getElementById('view-life').classList.contains('hidden')); assert.ok(!doc.getElementById('life-groceries').hidden && doc.getElementById('life-todos').hidden); assert.equal(w.location.hash,'#groceries');
  const input=doc.getElementById('quickGrocery'); input.value='<img src=x onerror=alert(1)>';
  doc.getElementById('quickGroceryForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await settle();
  assert.equal(doc.querySelectorAll('#groceryGroups .item-row').length,6); assert.equal(doc.querySelector('#groceryGroups img'),null);
  const item=[...doc.querySelectorAll('#groceryGroups .item-row')].find(r => r.textContent.includes('<img'));
  item.querySelector('[data-edit-item]').click(); assert.equal(doc.getElementById('itemDialog').open,true);
  doc.getElementById('itemTitle').value='Apples'; doc.getElementById('itemCategory').value='Produce'; doc.getElementById('itemQuantity').value='6';
  doc.getElementById('itemForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await settle();
  assert.equal(doc.getElementById('itemDialog').open,false); assert.ok(doc.getElementById('groceryGroups').textContent.includes('Apples'));
  const apple=[...doc.querySelectorAll('#groceryGroups .item-row')].find(r => r.textContent.includes('Apples')); apple.querySelector('input').click(); await settle();
  assert.match(doc.getElementById('groceryCount').textContent,/1 in the basket/);
  doc.getElementById('clearBought').click(); await settle(); assert.equal(doc.querySelectorAll('#groceryGroups .item-row').length,5);
  doc.querySelector('[data-life-tab="todos"]').click();
  const chore=doc.querySelector('#taskGroups [data-complete="d1"]'); chore.click(); await settle();
  assert.equal(doc.querySelector('#taskGroups [data-complete="d1"]').checked,false);
  assert.match(doc.getElementById('notice').textContent,/Next up/); doc.querySelector('#notice button').click(); await settle();
  assert.equal(doc.querySelector('#taskGroups [data-complete="d1"]').closest('.item-row').querySelector('.item-meta span').textContent,'Today');
  doc.querySelector('[data-kind="task"]').click();
  doc.querySelector('#life-todos [data-add-kind]').click();
  doc.getElementById('itemTitle').value='Book a cabin'; doc.getElementById('itemList').value='Weekend away';
  doc.getElementById('itemForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})); await settle();
  assert.match(doc.getElementById('taskGroups').textContent,/Weekend away/);
  assert.deepEqual(errors,[]);
});
test('the top event save creates only one event, and household all-day drag boundaries stay inclusive', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('quickEvent').click();
  assert.ok(!doc.getElementById('modalBackdrop').classList.contains('hidden'));
  doc.getElementById('evtTitle').value='One event, one click';
  doc.getElementById('saveBtnTop').click(); await settle();
  assert.ok(doc.getElementById('modalBackdrop').classList.contains('hidden'));
  assert.equal(w.__testApp.getDocs().filter(d => d.title === 'One event, one click').length,1);
  const id=w.__testApp.getDocs().find(d => d.title === 'One event, one click').id;
  await w.__testApp.persistMovedEvent({id,extendedProps:{},allDay:true,start:new w.Date('2026-11-15T00:00:00'),end:new w.Date('2026-11-18T00:00:00')});
  assert.equal(new Date(w.__testApp.getDocs().find(d => d.id === id).end).getDate(),17);
  assert.deepEqual(errors,[]);
});
test('a signed-in Firebase account without household membership cannot open the dashboard', async t => {
  const {dom,doc,errors,w}=await fixture({live:true}); t.after(() => dom.window.close());
  assert.ok(!doc.getElementById('gate').classList.contains('hidden'));
  assert.match(doc.getElementById('gateError').textContent,/not been added to the household/);
  assert.equal(w.__testApp.getDocs().length,0);
  const ids=[...doc.querySelectorAll('[id]')].map(x => x.id);
  assert.equal(ids.length,new Set(ids).size,'HTML element IDs must be unique');
  assert.deepEqual(errors,[]);
});

test('calendar person filters include shared plans, day selection opens the agenda, and adding uses the selected date', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-view="calendar"]').click();
  assert.deepEqual([...doc.querySelectorAll('.fc-col-header-cell-cushion')].map(el=>el.textContent), ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], 'Month headers must match the weekday columns in New York time');
  doc.querySelector('[data-owner="karena"]').click(); await settle();
  assert.equal(doc.querySelector('[data-owner="karena"]').getAttribute('aria-pressed'),'true');
  assert.ok(doc.querySelector('.fc-event.owner-karena'));
  assert.ok(doc.querySelector('.fc-event.owner-both'));
  assert.equal(doc.querySelector('.fc-event.owner-hanry'),null);
  doc.querySelector('[data-owner="all"]').click();
  const chosen = doc.querySelector('#homeWeek [data-home-date]');
  const selectedDate = chosen.dataset.homeDate;
  const dayButton = doc.querySelector(`.fc-daygrid-day[data-date="${selectedDate}"] .fc-daygrid-day-number`);
  dayButton.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await settle();
  assert.equal(dayButton.getAttribute('aria-pressed'),'true');
  assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),false); doc.getElementById('modalClose').click();
  assert.ok(doc.querySelector('#selectedDayEvents [data-calendar-event]'));
  doc.querySelector('#selectedDayEvents [data-calendar-event]').click();
  assert.ok(!doc.getElementById('modalBackdrop').classList.contains('hidden'));
  doc.getElementById('modalClose').click();
  doc.getElementById('addToDay').click();
  assert.equal(doc.getElementById('evtStart').value.slice(0,10),selectedDate);
  doc.getElementById('evtTitle').value='Plan from the day agenda';
  doc.getElementById('saveBtnTop').click(); await settle();
  assert.ok(doc.getElementById('selectedDayEvents').textContent.includes('Plan from the day agenda'));
  doc.querySelector('[data-calendar-view="timeGridWeek"]').click(); await settle();
  assert.equal(w.localStorage.getItem('hh_calendar_view'),'timeGridWeek');
  assert.equal(doc.querySelector('[data-calendar-view="timeGridWeek"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);
});

test('templates open editable drafts, create once on save, and show checklist progress without affecting existing events', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const before=JSON.stringify(w.__testApp.getDocs());
  doc.querySelector('[data-event-template="appointment"]').click();
  assert.equal(doc.getElementById('evtTitle').value,'Appointment');
  assert.equal(doc.querySelectorAll('#checklist .checkitem').length,2);
  assert.equal(JSON.stringify(w.__testApp.getDocs()),before);
  doc.getElementById('evtTitle').value='Appointment from a template';
  doc.getElementById('saveBtnTop').click(); await settle();
  assert.equal(w.__testApp.getDocs().filter(x=>x.title==='Appointment from a template').length,1);
  assert.ok(doc.querySelector('.event-checklist-progress[aria-label="0 of 2 checklist items complete"]'));
  doc.querySelector('[data-event-template="day-off"]').click();
  doc.getElementById('saveBtnTop').click(); await settle();
  const saved = w.__testApp.getDocs().find(x=>x.title==='Day off');
  assert.equal(saved.allDay,true);
  assert.equal(saved.end,null,'A one-day template must not create an extra all-day date');
  assert.deepEqual(errors,[]);
});

test('task filters combine with search, unchanged snapshots retain focused controls, and shortcuts respect typing and settings', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-life-tab="todos"]').click();
  doc.querySelector('[data-task-focus="today"]').click();
  assert.equal(doc.querySelectorAll('#taskGroups .item-row').length,2);
  const input=doc.getElementById('taskSearch'); input.value='WATER';
  input.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(doc.querySelectorAll('#taskGroups .item-row').length,1);
  const control=doc.querySelector('#taskGroups [data-edit-item]'); control.focus();
  w.__testApp.redraw();
  assert.equal(doc.activeElement,control);
  assert.equal(doc.querySelector('#taskGroups [data-edit-item]'),control);
  input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'n',bubbles:true,cancelable:true}));
  assert.ok(doc.getElementById('modalBackdrop').classList.contains('hidden'));
  doc.getElementById('resetTaskFilters').click();
  assert.equal(doc.querySelectorAll('#taskGroups .item-row').length,3);
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'/',bubbles:true,cancelable:true})); await settle();
  assert.equal(doc.activeElement.id,'searchInput');
  const toggle=doc.getElementById('keyboardShortcuts'); toggle.click();
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'n',bubbles:true,cancelable:true}));
  assert.ok(doc.getElementById('modalBackdrop').classList.contains('hidden'));
  toggle.click();
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'n',bubbles:true,cancelable:true}));
  assert.ok(!doc.getElementById('modalBackdrop').classList.contains('hidden'));
  assert.deepEqual(errors,[]);
});

test('a failed task update restores the checkbox and permits retry when cached markup is unchanged', async t => {
  const {dom,doc,errors}=await fixture({failItemUpdate:true}); t.after(() => dom.window.close());
  doc.querySelector('[data-life-tab="todos"]').click();
  const checkbox=doc.querySelector('#taskGroups [data-complete="d1"]'); checkbox.click(); await settle();
  assert.equal(doc.querySelector('#taskGroups [data-complete="d1"]'),checkbox);
  assert.equal(checkbox.checked,false);
  assert.equal(checkbox.disabled,false);
  assert.match(doc.getElementById('notice').textContent,/connection interrupted/);
  assert.deepEqual(errors,[]);
});

test('Today contains the live week calendar and adding there updates both calendar views', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  assert.ok(doc.querySelector('#view-today > :first-child').classList.contains('home-calendar'));
  assert.equal(doc.querySelectorAll('#homeWeek .home-week-day').length,7);
  assert.ok(doc.querySelector('#homeWeek [data-home-event="sample7"]'));
  doc.querySelector('#homeWeek [data-home-event="sample1"]').click();
  assert.ok(!doc.getElementById('modalBackdrop').classList.contains('hidden'));
  assert.equal(w.location.hash,'#today');
  doc.getElementById('modalClose').click();
  const chosen = [...doc.querySelectorAll('[data-home-add]')].at(-1);
  chosen.click();
  assert.equal(doc.getElementById('evtStart').value.slice(0,10),chosen.dataset.homeAdd);
  doc.getElementById('evtTitle').value='From the home calendar';
  doc.getElementById('saveBtnTop').click(); await settle();
  const created = w.__testApp.getDocs().find(event=>event.title==='From the home calendar');
  assert.ok(doc.querySelector(`#homeWeek [data-home-event="${created.id}"]`));
  assert.ok([...doc.querySelectorAll('#calendarGrid .smart-event-title')].some(el=>el.textContent==='From the home calendar'));
  doc.querySelector('[data-owner="karena"]').click();
  assert.ok(doc.querySelector('#homeWeek [data-home-event="sample7"]'), 'Home always shows everyone, independent of full-calendar filters');
  assert.equal(doc.getElementById('homeCalendarStatus').textContent,'Sample calendar');
  assert.deepEqual(errors,[]);
});

test('event checklist completion is shared with Chores & Lists, and stale editors cannot undo it',async t=>{
  const {dom,w,doc,errors}=await fixture();t.after(()=>dom.window.close());
  doc.getElementById('quickEvent').click();doc.getElementById('evtTitle').value='Weekend packing';
  doc.getElementById('addCheckItem').click();doc.querySelector('#checklist input[type="text"]').value='Pack Frankie’s snacks';
  doc.getElementById('saveBtnTop').click();await settle();
  const record=w.__testApp.getDocs().find(record=>record.title==='Weekend packing');assert.equal(record.checklist.length,1);
  doc.querySelector('[data-life-tab="todos"]').click();doc.querySelector('[data-kind="task"]').click();
  assert.match(doc.getElementById('eventChecklistGroups').textContent,/Weekend packing/);
  doc.querySelector('[data-event-check]').click();await settle();assert.equal(w.__testApp.getDocs().find(r=>r.id===record.id).checklist[0].done,true);
  doc.getElementById('showCompleted').click();doc.querySelector('[data-edit-event-checklist]').click();assert.equal(doc.querySelector('#taskChecklist input[type="checkbox"]').checked,true);
  doc.querySelector('#taskChecklist input[type="text"]').value='Pack snacks and bottles';doc.getElementById('taskDone').click();await settle();assert.match(doc.getElementById('eventChecklistGroups').textContent,/snacks and bottles/);
  doc.querySelector('[data-view="today"]').click();doc.querySelector(`[data-home-event="${record.id}"]`).click();
  // A second session completes/changes the stored checklist while this editor is open.
  w.__testApp.getDocs().find(r=>r.id===record.id).checklist[0].done=false;
  doc.getElementById('saveBtnTop').click();await settle();assert.match(doc.getElementById('evtError').textContent,/checklist changed/);assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),false);
  assert.deepEqual(errors,[]);
});
test('standalone checklists create multiple shared items without creating a calendar event',async t=>{
  const {dom,w,doc,errors}=await fixture();t.after(()=>dom.window.close());const before=w.__testApp.getDocs().length;
  doc.querySelector('[data-life-tab="todos"]').click();doc.querySelector('[data-kind="task"]').click();doc.getElementById('newChecklist').click();
  doc.getElementById('standaloneChecklistName').value='Clean shower';doc.getElementById('standaloneChecklistItems').value='Spray tiles\nScrub grout\nRinse and dry';
  doc.getElementById('standaloneChecklistForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(doc.getElementById('standaloneChecklistDialog').open,false);assert.match(doc.getElementById('taskGroups').textContent,/Clean shower/);assert.match(doc.getElementById('taskGroups').textContent,/Rinse and dry/);assert.equal(w.__testApp.getDocs().length,before);assert.deepEqual(errors,[]);
});
test('read-only Apple checklist steps save through household metadata and never create local calendar duplicates',async t=>{
  const {dom,w,doc,errors}=await fixture();t.after(()=>dom.window.close());const date=new Date().toISOString();
  const record={id:'apple-checklist',icloud:true,uid:'stable',calendarId:'cal',token:'token',title:'Apple appointment',start:date,end:date,cloudEnd:date,owner:'both',ownerCustom:'',withFrankie:true,readOnlyReason:'Edit this invitation in Apple.',assignmentVersion:2,checklist:[{id:'id-card',text:'Bring ID',done:false}]};
  w.__testApp.setCloudDocs([record]);const calls=[];w.saveCloudAssignment=async(assignment,original)=>{calls.push({assignment,original});return {assignment:{...assignment,assignmentVersion:3}};};w.saveCloudEvent=async()=>{throw new Error('Checklist must not write to Apple');};
  doc.querySelector('[data-life-tab="todos"]').click();doc.querySelector('[data-kind="task"]').click();doc.querySelector('[data-event-check="apple-checklist"]').click();await settle();
  assert.equal(calls.length,1);assert.equal(calls[0].assignment.checklist[0].done,true);assert.equal(calls[0].original.assignmentVersion,2);assert.equal(w.__testApp.getDocs().filter(r=>r.title==='Apple appointment').length,1);assert.equal(w.__testApp.getDocs().find(r=>r.id==='apple-checklist').assignmentVersion,3);assert.deepEqual(errors,[]);
});

test('a partial Apple save retains the checklist draft and retries only household metadata',async t=>{
  const {dom,w,doc,errors}=await fixture();t.after(()=>dom.window.close());let appleWrites=0,metadataWrites=0;
  w.saveCloudEvent=async()=>{appleWrites++;return {saved:true,token:'saved-resource',uid:'saved-uid',assignmentSaved:false,warning:'Apple saved; keep your checklist here.'};};
  w.saveCloudAssignment=async(assignment,original)=>{metadataWrites++;assert.equal(original.uid,'saved-uid');assert.equal(original.token,'saved-resource');assert.equal(assignment.checklist[0].text,'Pack a bottle');return {saved:true};};
  doc.getElementById('quickEvent').click();const calendar=doc.getElementById('evtCalendar');calendar.add(new w.Option('Apple','cal'));calendar.value='cal';calendar.dispatchEvent(new w.Event('change'));
  doc.getElementById('evtTitle').value='New Apple appointment';doc.getElementById('addCheckItem').click();doc.querySelector('#checklist input[type="text"]').value='Pack a bottle';
  doc.getElementById('saveBtnTop').click();await settle();assert.equal(appleWrites,1);assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),false);assert.equal(doc.getElementById('evtTitle').disabled,true);assert.equal(doc.querySelector('#checklist input[type="text"]').value,'Pack a bottle');
  doc.getElementById('saveBtnTop').click();await settle();assert.equal(appleWrites,1);assert.equal(metadataWrites,1);assert.equal(doc.getElementById('modalBackdrop').classList.contains('hidden'),true);assert.deepEqual(errors,[]);
});
test('quick add, the command palette, Now & Next, the Frankie page and the after-dark joke work in the preview', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  // Natural-language quick add opens a prefilled draft; nothing saves until the editor does.
  const before = w.__testApp.getDocs().length;
  doc.getElementById('quickAddInput').value = 'Pediatrician Tue 3pm with Frankie';
  doc.getElementById('quickAddInput').dispatchEvent(new w.Event('input'));
  assert.match(doc.getElementById('quickAddPreview').textContent, /Pediatrician · Tue/);
  doc.getElementById('quickAddForm').dispatchEvent(new w.Event('submit', { cancelable:true }));
  assert.ok(!doc.getElementById('modalBackdrop').classList.contains('hidden'));
  assert.equal(doc.getElementById('evtTitle').value, 'Pediatrician'); assert.equal(doc.getElementById('evtWithFrankie').checked, true);
  assert.equal(w.__testApp.getDocs().length, before); doc.getElementById('modalClose').click();
  // ⌘K / Ctrl+K opens the palette; typing filters; Enter runs the choice.
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true }));
  assert.equal(doc.getElementById('paletteDialog').open, true);
  const input = doc.getElementById('paletteInput'); input.value = 'groceries'; input.dispatchEvent(new w.Event('input'));
  assert.match(doc.querySelector('#paletteList [aria-selected="true"]').textContent, /Groceries/);
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Enter', bubbles:true })); await settle();
  assert.equal(doc.getElementById('paletteDialog').open, false); assert.equal(w.location.hash, '#groceries');
  // The cat tracker is gone; Now & Next lives under the page title.
  assert.equal(doc.getElementById('catCare'), null); assert.ok(doc.querySelector('.house-header + #nowNext'));
  assert.match(doc.getElementById('nowNext').textContent, /Next:/);
  // Three nap predictions on Home; the Frankie page renders charts and the scoreboard.
  assert.equal(doc.querySelectorAll('#babyPredictions .nap-card').length, 3);
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  assert.ok(doc.querySelector('#frankieBottles svg .mark-bottle')); assert.ok(doc.querySelector('#frankieTimeline svg .mark-nap'));
  assert.equal(doc.querySelectorAll('#frankieScore .score-card').length, 3);
  assert.equal(doc.querySelectorAll('#frankieLinks .link-row').length, 4); assert.match(doc.getElementById('frankieLinks').textContent, /Frankie is 4 months old/);
  assert.match(doc.getElementById('frankieScore').textContent, /keep the forecasts her first version made/);
  // The after-dark joke is folded away and can be hidden per device.
  assert.equal(doc.getElementById('afterDarkJoke').open, false); assert.ok(doc.getElementById('afterDarkSetup').textContent.length > 8);
  doc.getElementById('afterDarkSetting').checked = false; doc.getElementById('afterDarkSetting').dispatchEvent(new w.Event('change'));
  assert.equal(doc.getElementById('afterDarkJoke').hidden, true); assert.equal(w.localStorage.getItem('hh_after_dark'), '0');
  assert.deepEqual(errors, []);
});

test('quick add logs for Frankie: bottle defaults to the last one, text fills the window, diapers and naps too', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const input = doc.getElementById('quickAddInput'), form = doc.getElementById('quickAddForm');
  const type = text => { input.value = text; input.dispatchEvent(new w.Event('input')); };
  // A plain bottle opens with the last bottle's amount and milk.
  doc.querySelector('#view-today [data-baby-log="bottle"]').click();
  const sameAs = doc.getElementById('babyLogSame');
  assert.equal(sameAs.hidden, false); assert.match(sameAs.textContent, /^Same as last · /);
  assert.equal(doc.getElementById('babyLogAmount').value, sameAs.dataset.amount);
  doc.getElementById('babyLogClose').click();
  // Typed amount and time win.
  type('frankie bottle 4.5oz breast milk 20 min ago');
  assert.match(doc.getElementById('quickAddPreview').textContent, /Bottle for Frankie · .* · 4\.5 oz Breast Milk/);
  form.dispatchEvent(new w.Event('submit', { cancelable:true }));
  assert.equal(doc.getElementById('babyLogDialog').open, true); assert.equal(doc.getElementById('babyLogTitle').textContent, 'Bottle');
  assert.equal(doc.getElementById('babyLogAmount').value, '4.5'); assert.equal(doc.getElementById('babyLogMilk').value, 'Breast Milk');
  assert.ok(Math.abs(new Date(doc.getElementById('babyLogStart').value) - (Date.now() - 20 * 60000)) < 2 * 60000);
  assert.equal(doc.querySelector('[data-pills="babyLogMilk"] [data-value="Breast Milk"]').getAttribute('aria-pressed'), 'true');
  // Stepper and chips edit the real inputs.
  doc.querySelector('[data-step="1"]').click(); assert.equal(doc.getElementById('babyLogAmount').value, '5');
  doc.querySelector('#babyLogAmountChips [data-amount="3"]').click(); assert.equal(doc.getElementById('babyLogAmount').value, '3');
  doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  assert.equal(doc.getElementById('babyLogDialog').open, false); assert.equal(input.value, '');
  // A bottle logged now becomes the default for the next one (a backdated one doesn't).
  doc.querySelector('#view-today [data-baby-log="bottle"]').click();
  doc.querySelector('#babyLogAmountChips [data-amount="3"]').click(); doc.querySelector('[data-pills="babyLogMilk"] [data-value="Breast Milk"]').click();
  doc.querySelector('[data-time-chips="babyLogStart"] [data-ago="0"]').click();
  doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  doc.querySelector('#view-today [data-baby-log="bottle"]').click();
  assert.equal(doc.getElementById('babyLogAmount').value, '3'); assert.equal(doc.getElementById('babyLogMilk').value, 'Breast Milk');
  doc.getElementById('babyLogClose').click();
  // Diaper via pills; a nap range opens a finished sleep.
  type('frankie diaper poop'); form.dispatchEvent(new w.Event('submit', { cancelable:true }));
  assert.equal(doc.getElementById('babyLogDiaper').value, 'poo'); assert.equal(doc.querySelector('[data-pills="babyLogDiaper"] [data-value="poo"]').getAttribute('aria-pressed'), 'true');
  doc.getElementById('babyLogClose').click();
  type('frankie nap 30 min'); form.dispatchEvent(new w.Event('submit', { cancelable:true }));
  assert.equal(doc.getElementById('babyLogTitle').textContent, 'Finished sleep'); assert.match(doc.getElementById('babyLogDuration').textContent, /30m of sleep/);
  doc.getElementById('babyLogClose').click();
  // Calendar plans that mention Frankie are still plans.
  type('Frankie swim class Tue 3pm'); assert.match(doc.getElementById('quickAddPreview').textContent, /Swim class · Tue.*\+ Frankie/);
  assert.deepEqual(errors, []);
});

test('Settings explains the "Frankie log" shortcut, and the preview creates no keys', async t => {
  const {dom,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const panel = doc.getElementById('siriPanel');
  assert.match(panel.textContent, /doesn’t create keys/);
  assert.match(panel.textContent, /Frankie log/); assert.match(panel.textContent, /Get Contents of URL/); assert.match(panel.textContent, /Bearer/);
  assert.equal(doc.getElementById('siriCreate'), null);
  assert.deepEqual(errors, []);
});

test('a failed newsletter test names the step it stopped at', async t => {
  const {dom,w}=await fixture(); t.after(() => dom.window.close());
  const at = '2026-11-17T15:00:00.000Z';
  assert.match(w.lastTestNote({ step:'reading Frankie’s Huckleberry data', updatedAt:at, ms:62000, finished:false }), /stopped while reading Frankie’s Huckleberry data \(after 62s\)/);
  assert.match(w.lastTestNote({ step:'handing the email to Gmail', updatedAt:at, ms:9000, finished:true, ok:false, error:'Gmail didn’t answer in time.' }), /Gmail didn’t answer in time\./);
  assert.match(w.lastTestNote({ step:'sent', updatedAt:at, ms:31000, finished:true, ok:true }), /Last test sent .*\(31s\)/);
  assert.match(w.lastTestNote(null), /hidden/);
  assert.doesNotMatch(w.lastTestNote({ step:'<img src=x onerror=alert(1)>', updatedAt:at, finished:false }), /<img/);
});
test('Devices page: app tiles, Hue rooms and Sonos speakers work in the preview', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-view="devices"]').click(); await settle();
  assert.equal(doc.getElementById('view-devices').classList.contains('hidden'),false);
  assert.equal(doc.getElementById('viewTitle').textContent,'Smart home');
  assert.equal(doc.querySelectorAll('#deviceLauncher [data-device-open]').length,w.DEVICE_APPS.length);
  assert.equal(doc.querySelectorAll('#huePanel .hue-room').length,4);
  const nursery=[...doc.querySelectorAll('.hue-room')].find(room => room.textContent.includes('Nursery'));
  const power=nursery.querySelector('[data-hue-power]'); power.checked=true; power.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(doc.getElementById('huePanel').textContent,/3 of 4 rooms on/);
  doc.querySelector('[data-hue-all="off"]').click();
  assert.match(doc.getElementById('huePanel').textContent,/0 of 4 rooms on/);
  const kitchen=doc.querySelector('[data-sonos="toggle"][data-group="gk"]'); assert.equal(kitchen.getAttribute('aria-label'),'Pause'); kitchen.click();
  assert.equal(doc.querySelector('[data-sonos="toggle"][data-group="gk"]').getAttribute('aria-label'),'Play');
  // A custom tile is saved on this device; unsafe links are refused.
  const answers=['Ring','javascript:alert(1)']; w.prompt=() => answers.shift();
  doc.querySelector('[data-device-add]').click(); assert.equal(doc.querySelectorAll('[data-device-open]').length,w.DEVICE_APPS.length);
  const ok=['Ring','ring://']; w.prompt=() => ok.shift();
  doc.querySelector('[data-device-add]').click(); assert.equal(doc.querySelectorAll('[data-device-open]').length,w.DEVICE_APPS.length+1);
  assert.match(w.localStorage.getItem('hh_device_links'),/ring:\/\//);
  assert.match(doc.getElementById('devicesSettingsPanel').textContent,/Connected/);
  assert.equal(doc.querySelectorAll('#litterPanel .lr-cat').length,3); assert.doesNotMatch(doc.getElementById('litterPanel').textContent,/top visitor|this week/);
  assert.match(doc.getElementById('litterSettingsPanel').textContent,/Connected/);
  assert.equal(doc.querySelectorAll('#feederPanel .feeder').length,2); assert.match(doc.getElementById('feederPanel').textContent,/Food is running low/);
  assert.match(doc.getElementById('nowNext').textContent,/Mia’s Dinerfood low/);
  assert.deepEqual(errors,[]);
});
test('birthdays from Contacts show on Today and in Settings, and the calendar switch hides them', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  await settle();
  const today=doc.querySelector('#homeWeek .home-week-day.is-today');
  assert.match(today.querySelector('.home-birthday').textContent,/🎂 Grandma June turns \d+/);
  assert.match(doc.getElementById('birthdayPanel').textContent,/4 birthdays found/);
  assert.match(doc.getElementById('nowNext').textContent,/🎂Grandma June turns \d+today/);
  const brief=doc.querySelector('#briefInsights .has-birthday'); assert.match(brief.textContent,/2 birthdays this week/); assert.match(brief.textContent,/Grandma June turns \d+ today · Sam Rivera’s birthday \w+day/);
  doc.querySelector('[data-view="calendar"]').click(); await settle();
  assert.match(doc.getElementById('selectedDayEvents').querySelector('.day-birthday:not(.day-bath):not(.day-trash)').textContent,/Grandma June/); // bath and bin days share the style
  assert.equal(doc.getElementById('birthdayToggle').checked,true);
  const toggle=doc.getElementById('calendarBirthdays'); assert.equal(toggle.checked,true);
  toggle.checked=false; toggle.dispatchEvent(new w.Event('change'));
  assert.equal(doc.querySelectorAll('#homeWeek .home-birthday').length,0); assert.equal(w.localStorage.getItem('hh_birthdays'),'0');
  assert.equal(doc.querySelector('#briefInsights .has-birthday'),null); assert.doesNotMatch(doc.getElementById('nowNext').textContent,/Grandma/);
  assert.deepEqual(errors,[]);
});
test('a missed nap can be recovered from the scoreboard in the preview', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  const missed=[...doc.querySelectorAll('#frankieScore [data-rewind-wake]')];
  if (!missed.length) { t.skip('the sample week has no missed naps'); return; }
  const before=doc.querySelectorAll('#frankieScore [data-rewind-wake]').length;
  missed[0].click(); await settle();
  const panel=doc.getElementById('rewindPanel'); assert.equal(panel.hidden,false); assert.match(panel.textContent,/out of Huckleberry for the moment/);
  panel.querySelector('[data-recover="check"]').click(); await settle();
  assert.match(panel.textContent,/Huckleberry now says/);
  panel.querySelector('[data-recover="save"]').click(); await settle();
  assert.equal(panel.hidden,true); assert.match(doc.getElementById('notice').textContent,/Mack’s pick is saved/);
  assert.equal(doc.querySelectorAll('#frankieScore [data-rewind-wake]').length,before-1);
  assert.deepEqual(errors,[]);
});
test('a failing extra never blanks the prediction cards, and says what broke', async t => {
  const {dom,w,doc}=await fixture(); t.after(() => dom.window.close());
  w.dayStripSVG=() => { throw new Error('strip exploded'); };
  doc.getElementById('babyRefresh').click(); await settle();
  assert.equal(doc.querySelectorAll('#babyPredictions .nap-card').length,3);
  assert.match(doc.getElementById('babyPredictions').textContent,/Part of the forecast couldn’t be drawn \(Day strip: strip exploded\)/);
  assert.equal(doc.getElementById('babyStrip').hidden,true);
  assert.equal(doc.getElementById('frankieGuessCard').hidden,true,'the Frankie page copy hides too');
  w.purrfectWindow=() => { throw new Error('hubert tripped'); };
  doc.getElementById('babyRefresh').click(); await settle();
  assert.match(doc.getElementById('babyPredictions').textContent,/The predictions couldn’t be drawn: hubert tripped/);
});
test('Life: chores and groceries share one page, and Meals plans dinner around the BOGOs', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const nav=[...doc.querySelectorAll('.house-nav [data-view]')].map(b => b.dataset.view);
  assert.ok(nav.includes('life') && !nav.includes('tasks') && !nav.includes('groceries'));
  // Old links still land on the right tab.
  doc.querySelector('[data-go="tasks"]').click();
  assert.equal(doc.getElementById('viewTitle').textContent,'Life, handled.'); assert.equal(doc.getElementById('life-todos').hidden,false);
  assert.equal(doc.getElementById('lifeGroceryCount').textContent,'5');
  doc.querySelector('[data-life-tab="meals"]').click(); await settle();
  assert.equal(w.location.hash,'#meals'); assert.ok(doc.getElementById('life-todos').hidden && !doc.getElementById('life-meals').hidden);
  // Tonight's planned favorite, then ideas: favorites first, then ones using this week's BOGOs.
  assert.match(doc.querySelector('.meal-day').textContent,/Tonight.*Karena’s turkey chili/);
  const ideas=[...doc.querySelectorAll('.meal-idea')];
  assert.equal(ideas.length,6); assert.ok(ideas[0].classList.contains('favorite')); assert.match(ideas[0].textContent,/pancakes/, 'never made comes first');
  assert.ok(ideas.some(card => card.classList.contains('idea') && card.querySelectorAll('.bogo-chip').length>=3));
  assert.ok(doc.querySelectorAll('#bogoPanel .bogo-item').length>=10); assert.match(doc.getElementById('bogoPanel').textContent,/Carytown Exchange/);
  // One tap puts the missing ingredients on the grocery list.
  const idea=ideas.find(card => card.classList.contains('idea')), name=idea.querySelector('h3').textContent;
  idea.querySelector('[data-idea-shop]').click(); await settle();
  assert.match(doc.getElementById('notice').textContent,new RegExp(`for ${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} to Groceries`));
  assert.ok(Number(doc.getElementById('lifeGroceryCount').textContent)>5);
  // Plan an idea for an open day, save one as a favorite, add a BOGO to the list.
  const pick=doc.querySelector('[data-idea-plan]'), planned=pick.closest('.meal-idea').querySelector('h3').textContent; pick.value=pick.options[1].value; pick.dispatchEvent(new w.Event('change',{bubbles:true})); await settle();
  assert.ok([...doc.querySelectorAll('.meal-day.planned')].some(row => row.textContent.includes(planned)));
  doc.querySelector('[data-idea-save]').click(); await settle(); assert.match(doc.getElementById('notice').textContent,/saved to your favorites/);
  const before=doc.querySelectorAll('#mealFavorites li').length; assert.equal(before,5);
  doc.querySelector('[data-bogo-add]').click(); await settle(); assert.match(doc.getElementById('notice').textContent,/on the grocery list/);
  // Mark tonight made, and save a favorite by hand.
  doc.querySelector('[data-meal-made]').click(); await settle(); assert.match(doc.querySelector('.meal-day').textContent,/Made ✓/);
  doc.querySelector('[data-meal-new]').click(); doc.getElementById('mealName').value='Friday pizza'; doc.getElementById('mealIngredients').value='pizza dough, pasta sauce, shredded mozzarella';
  doc.getElementById('mealForm').requestSubmit(); await settle();
  assert.ok(!doc.getElementById('mealDialog').open); assert.ok(doc.getElementById('mealFavorites').textContent.includes('Friday pizza'));
  assert.deepEqual(errors,[]);
});
test('Meals: every dinner opens a recipe card with numbered steps', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-life-tab="meals"]').click(); await settle();
  // Tonight's favorite has the household's own steps.
  doc.querySelector('.meal-day [data-meal-recipe]').click(); await settle();
  const dialog=doc.getElementById('recipeDialog');
  assert.ok(dialog.open); assert.equal(doc.getElementById('recipeTitle').textContent,'Karena’s turkey chili');
  assert.match(doc.getElementById('recipeMeta').textContent,/FAVORITE · 45 MIN/);
  assert.equal(dialog.querySelectorAll('.recipe-steps li').length,4); assert.match(dialog.querySelector('.recipe-steps').textContent,/simmer 30 minutes/);
  // Edit opens the form with those steps filled in.
  dialog.querySelector('[data-recipe-edit]').click();
  assert.ok(!dialog.open && doc.getElementById('mealDialog').open); assert.match(doc.getElementById('mealSteps').value,/^Soften the onion/); assert.equal(doc.getElementById('mealMinutes').value,'45');
  doc.getElementById('mealSteps').value='1. Brown the turkey\n2. Simmer all afternoon'; doc.getElementById('mealForm').requestSubmit(); await settle();
  doc.querySelector('.meal-day [data-meal-recipe]').click(); await settle();
  assert.deepEqual([...dialog.querySelectorAll('.recipe-steps li')].map(li => li.textContent),['Brown the turkey','Simmer all afternoon']);
  dialog.querySelector('[data-recipe-close]').click(); assert.ok(!dialog.open);
  // A library idea: steps, BOGO tags, and one tap to shop or save.
  const card=doc.querySelector('.meal-idea.idea'), name=card.querySelector('h3').textContent;
  assert.match(card.querySelector('header small').textContent,/\d+ min/);
  card.querySelector('[data-idea-recipe]').click(); await settle();
  assert.equal(doc.getElementById('recipeTitle').textContent,name); assert.ok(dialog.querySelectorAll('.recipe-steps li').length>=3);
  assert.ok(dialog.querySelector('.recipe-ingredients small.deal'), 'BOGO ingredients are marked');
  dialog.querySelector('[data-recipe-shop]').click(); await settle();
  assert.match(doc.getElementById('notice').textContent,/to Groceries/); assert.ok(dialog.open, 'stays open while you shop');
  dialog.querySelector('[data-recipe-save]').click(); await settle();
  assert.ok(!dialog.open); assert.ok(doc.getElementById('mealFavorites').textContent.includes(name));
  // The saved copy keeps the steps.
  const saved=[...doc.querySelectorAll('#mealFavorites li')].find(li => li.textContent.includes(name)); saved.querySelector('[data-meal-recipe]').click(); await settle();
  assert.ok(dialog.querySelectorAll('.recipe-steps li').length>=3);
  assert.deepEqual(errors,[]);
});
test('groceries: one tap or a swipe removes an item, with Undo', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-life-tab="groceries"]').click(); await settle();
  const count=() => Number(doc.getElementById('lifeGroceryCount').textContent || 0), row=name => [...doc.querySelectorAll('#groceryGroups .item-row')].find(r => r.textContent.includes(name));
  assert.equal(count(),5);
  // One tap, no confirm box.
  w.confirm=() => { throw new Error('should not ask'); };
  row('Avocados').querySelector('[data-delete-item]').click(); await settle();
  assert.equal(row('Avocados'),undefined); assert.equal(count(),4); assert.match(doc.getElementById('notice').textContent,/Removed Avocados/);
  doc.querySelector('#notice button').click(); await settle();
  assert.ok(row('Avocados'),'Undo puts it back'); assert.equal(count(),5);
  assert.equal(row('Avocados').querySelector('.item-meta').textContent,'3 ripe ones','with its details');
  // Swipe left past the line removes; a short swipe springs back.
  const swipe=(target,dx,dy=0) => { const fire=(type,x,y) => { const e=new w.Event(type,{bubbles:true}); Object.defineProperty(e,'touches',{value:type==='touchend'?[]:[{clientX:x,clientY:y}]}); target.dispatchEvent(e); };
    fire('touchstart',300,100); for (let i=1;i<=6;i++) fire('touchmove',300+dx*i/6,100+dy*i/6); fire('touchend',0,0); };
  swipe(row('Sourdough').querySelector('.item-copy'),-50); await settle(250);
  assert.ok(row('Sourdough')); assert.equal(row('Sourdough').style.transform,'');
  swipe(row('Sourdough').querySelector('.item-copy'),-20,-140); await settle(250);
  assert.ok(row('Sourdough'),'scrolling up and down is not a swipe');
  swipe(row('Sourdough').querySelector('.item-copy'),-180); await new Promise(r => setTimeout(r,300));
  assert.equal(row('Sourdough'),undefined); assert.equal(count(),4);
  // Chores don't get the × (their delete stays in the edit dialog).
  doc.querySelector('[data-life-tab="todos"]').click(); assert.equal(doc.querySelectorAll('#taskGroups [data-delete-item]').length,0);
  assert.deepEqual(errors,[]);
});
test('quick add logs Karena’s pumps (both sides) straight to the Frankie page', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const input = doc.getElementById('quickAddInput'), form = doc.getElementById('quickAddForm');
  const type = text => { input.value = text; input.dispatchEvent(new w.Event('input')); };
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  const today = () => doc.querySelector('#frankiePumps .frankie-tile strong').textContent;
  const before = parseFloat(today());
  // A total alone isn't saved: it asks for the sides.
  type('karena pumped 5 oz');
  assert.match(doc.getElementById('quickAddPreview').textContent, /Pump for Karena .* 5 oz total, add left and right/);
  form.dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  // A total alone opens the Pump window, split evenly to start, so the sides can be set.
  assert.equal(doc.getElementById('babyLogDialog').open, true); assert.equal(doc.getElementById('babyLogTitle').textContent, 'Pump');
  assert.equal(doc.getElementById('babyLogFor').textContent, 'FOR KARENA');
  assert.deepEqual([doc.getElementById('babyLogLeft').value, doc.getElementById('babyLogRight').value], ['2.5', '2.5']);
  doc.getElementById('babyLogClose').click(); assert.equal(parseFloat(today()), before);
  type('karena pumped left 2 right 2.5');
  assert.match(doc.getElementById('quickAddPreview').textContent, /Pump for Karena · .* · L 2 oz · R 2\.5 oz/);
  form.dispatchEvent(new w.Event('submit', { cancelable:true })); await settle();
  assert.match(doc.getElementById('notice').textContent, /Logged a pump: left 2 oz, right 2\.5 oz/);
  assert.equal(input.value, ''); assert.ok(Math.abs(parseFloat(today()) - (before + 4.5)) < 0.15, `${before} → ${today()}`);
  assert.ok(doc.getElementById('babyLogDialog').open !== true, 'no dialog needed');
  assert.deepEqual(errors, []);
});
test('bath days: pick them in Settings and they show on the calendar and Today', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const pressed = () => [...doc.querySelectorAll('#bathPanel [data-bath-day]')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);
  assert.deepEqual(pressed(), ['Wed', 'Sun'], 'Wednesday and Sunday to start');
  assert.match(doc.getElementById('bathPanel').textContent, /Wednesdays and Sundays/);
  // The week strip on Today shows them on the right days.
  const stripDays = () => [...doc.querySelectorAll('#homeWeek .home-week-day')].filter(d => d.querySelector('.home-bath')).map(d => new Date(`${d.dataset.homeDate}T12:00:00`).getDay());
  assert.ok(stripDays().length >= 1 && stripDays().every(day => [0, 3].includes(day)), String(stripDays()));
  // Add Friday, drop Wednesday.
  doc.querySelector('#bathPanel [data-bath-day="5"]').click(); doc.querySelector('#bathPanel [data-bath-day="3"]').click(); await settle();
  assert.deepEqual(pressed(), ['Fri', 'Sun']); assert.match(doc.getElementById('bathPanel').textContent, /Fridays and Sundays/);
  assert.ok(stripDays().every(day => [0, 5].includes(day)) && stripDays().length >= 1, String(stripDays()));
  assert.deepEqual(errors, []);
});
test('Frankie page: the cats’ windows on a day strip, and a bottle pace tracker', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  const card = doc.getElementById('frankieGuessCard');
  assert.equal(card.hidden, false);
  assert.ok(doc.querySelector('#frankieStrip svg.day-strip'), 'the same strip as Today');
  assert.deepEqual([...doc.querySelectorAll('#frankieGuessList li')].map(li => li.className.split(' ')[0]), ['guess-hubert', 'guess-mia', 'guess-mack'], 'Hubert, Mia, Mack');
  // Each cat with a call shows its window; the strip draws the same picks as Today's.
  // The Frankie strip always has all three lanes, names pinned on the left, and scrolls sideways.
  assert.deepEqual([...doc.querySelectorAll('#frankieStrip .strip-name')].map(n => n.textContent), ['Hubert', 'Mia', 'Mack']);
  const scroller = doc.querySelector('#frankieStrip .strip-scroll'), svg = scroller.querySelector('svg.is-scrolling');
  assert.ok(Number(svg.getAttribute('width')) >= 64 * 10, 'drawn at about an hour per 64px, wider than a phone');
  // Earlier sleeps today keep each cat's guess (faded), with the moment she fell asleep marked.
  const earlierRows = doc.querySelectorAll('#frankieGuessList .guess-table tbody tr');
  assert.equal(svg.querySelectorAll('.strip-actual').length, earlierRows.length);
  if (earlierRows.length) assert.ok(svg.querySelector('.strip-dot.past'), 'earlier guesses are drawn');
  // Every challenge has a slide in the cats' calls, Hubert, Mia, Mack on each.
  assert.deepEqual([...doc.querySelectorAll('[data-calls-tab]')].map(b => b.textContent), ['Next nap', 'Nap or night', 'Morning', 'Bottles', 'Pumps']);
  for (const id of ['callsNapNight', 'callsMorning', 'callsBottle']) assert.deepEqual([...doc.querySelectorAll(`#${id} li`)].map(li => li.className.split(' ')[0]), ['guess-hubert', 'guess-mia', 'guess-mack'], id);
  assert.match(doc.getElementById('callsBottle').textContent, /So far today: .*oz/);
  assert.match(doc.getElementById('callsPump').textContent, /Pumped so far today|Log Karena’s pumps/);
  doc.querySelector('[data-calls-tab="3"]').click();
  assert.equal(doc.querySelector('[data-calls-tab="3"]').getAttribute('aria-selected'), 'true'); assert.equal(doc.querySelector('[data-calls-tab="0"]').getAttribute('aria-selected'), 'false');
  // Nap or night: a card per cat and a recent-wake-ups table.
  const napNight = doc.getElementById('frankieNapNight');
  assert.deepEqual([...napNight.querySelectorAll('.score-card h3')].map(h => h.textContent), ['Evening Instinct', 'Nap Counter', 'The Nap Plan']);
  assert.match(napNight.textContent, /called right/); assert.match(napNight.textContent, /4-nap SweetSpot plan/);
  // Bottle pace.
  assert.equal(doc.getElementById('frankiePaceCard').hidden, false);
  const pace = doc.getElementById('frankiePace');
  assert.match(pace.textContent, /On track|Ahead of pace|Behind pace/);
  assert.match(pace.textContent, /usually .* oz by now/); assert.match(pace.textContent, /target .* oz/);
  assert.ok(pace.querySelector('.pace-bar .pace-mark'), 'a marker for where she usually is by now');
  assert.match(pace.textContent, /Next bottle/);
  assert.deepEqual(errors, []);
});
test('logging windows: big Save that says what it will do, tucked-away times, sleep lengths, and a Pump window', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const save = () => doc.getElementById('babyLogSave').textContent, box = id => doc.getElementById(id).closest('.log-custom-time');
  // Bottle: Save names the amount; the exact time box is tucked away while a chip is chosen.
  doc.querySelector('#view-today [data-baby-log="bottle"]').click();
  assert.match(save(), /^Save \d+(\.\d+)? oz bottle$/); assert.equal(box('babyLogStart').hidden, true);
  doc.querySelector('[data-time-chips="babyLogStart"] [data-other-time]').click(); assert.equal(box('babyLogStart').hidden, false);
  doc.querySelector('#babyLogAmountChips [data-amount="3"]').click(); assert.equal(save(), 'Save 3 oz bottle');
  assert.equal(doc.getElementById('babyLogZone').textContent, '', 'no time-zone note when the device matches the household');
  doc.getElementById('babyLogClose').click();
  // Diaper: Save names the kind.
  doc.querySelector('#view-today [data-baby-log="diaper"]').click();
  doc.querySelector('[data-pills="babyLogDiaper"] [data-value="poo"]').click(); assert.equal(save(), 'Save dirty diaper');
  doc.getElementById('babyLogClose').click();
  // Finished sleep: tap how long she slept.
  doc.querySelector('#view-today [data-baby-log="sleep-log"]').click();
  doc.querySelector('#babyLogLengths [data-length="90"]').click();
  assert.equal(new Date(doc.getElementById('babyLogEnd').value) - new Date(doc.getElementById('babyLogStart').value), 90 * 60000);
  assert.equal(doc.querySelector('#babyLogLengths [data-length="90"]').getAttribute('aria-pressed'), 'true'); assert.equal(save(), 'Save 1h 30m sleep');
  doc.getElementById('babyLogClose').click();
  // Pump: a button on Today, both sides with steppers, saved to the Frankie page.
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  const before = parseFloat(doc.querySelector('#frankiePumps .frankie-tile strong').textContent);
  doc.querySelector('[data-baby-log="pump"]').click();
  assert.equal(doc.getElementById('babyLogTitle').textContent, 'Pump');
  doc.getElementById('babyLogLeft').value = '2'; doc.getElementById('babyLogRight').value = '2';
  doc.querySelector('[data-pump-step="babyLogRight:1"]').click();
  assert.equal(doc.getElementById('babyLogRight').value, '2.25'); assert.equal(save(), 'Save 4.25 oz pump'); assert.match(doc.getElementById('babyLogPumpTotal').textContent, /4.25 oz in all/);
  doc.getElementById('babyLogForm').dispatchEvent(new w.Event('submit', { cancelable:true })); await settle(); await settle();
  assert.equal(doc.getElementById('babyLogDialog').open, false);
  assert.ok(Math.abs(parseFloat(doc.querySelector('#frankiePumps .frankie-tile strong').textContent) - (before + 4.25)) < 0.15);
  assert.deepEqual(errors, []);
});
test('new event: title first, who’s coming as chips, and "Dinner Fri 7pm" sets the date and time', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('quickEvent').click(); await settle();
  const form = doc.getElementById('eventForm'), fields = [...form.querySelectorAll('#evtTitle, #evtCalendar')];
  assert.equal(fields[0].id, 'evtTitle', 'the title comes before the calendar picker');
  assert.equal(doc.getElementById('saveBtn').textContent, 'Add event'); assert.equal(doc.getElementById('saveBtnTop').textContent, 'Add');
  assert.equal(doc.querySelector('[data-owner-chip="both"]').getAttribute('aria-pressed'), 'true');
  doc.querySelector('[data-owner-chip="karena"]').click();
  assert.equal(doc.getElementById('evtOwner').value, 'karena'); assert.equal(doc.querySelector('[data-owner-chip="karena"]').getAttribute('aria-pressed'), 'true');
  const title = doc.getElementById('evtTitle'), hint = doc.getElementById('evtTitleHint');
  title.value = 'Dinner with friends'; title.dispatchEvent(new w.Event('input')); assert.equal(hint.hidden, true, 'no date, no hint');
  title.value = 'Dinner with friends Fri 7pm'; title.dispatchEvent(new w.Event('input'));
  assert.equal(hint.hidden, false); assert.match(hint.textContent, /Fri.*7:00/);
  hint.click();
  assert.equal(title.value, 'Dinner with friends'); assert.equal(doc.getElementById('evtStartTime').value, '19:00');
  assert.equal(new Date(`${doc.getElementById('evtStartDate').value}T12:00`).getDay(), 5, 'a Friday');
  assert.equal(hint.hidden, true);
  assert.deepEqual(errors, []);
});
test('events away from Richmond show the weather where they are', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  // The sample "weekend away" is in Nags Head: its Today card gets that town's weather (preview numbers, no network).
  await new Promise(r => setTimeout(r, 120));
  doc.querySelector('[data-home-view="week"]').click(); await settle();
  const line = [...doc.querySelectorAll('.home-event-weather')].map(n => n.textContent);
  assert.ok(line.some(text => /°\/\d+° in Nags Head/.test(text)), JSON.stringify(line));
  assert.ok(![...doc.querySelectorAll('.home-week-event')].filter(card => !card.textContent.includes('weekend away')).some(card => card.querySelector('.home-event-weather')), 'only events with a faraway location');
  // A new event: the Where field saves, and a Richmond address shows no weather line.
  doc.getElementById('quickEvent').click(); await settle();
  assert.ok(doc.getElementById('evtLocation'));
  doc.getElementById('evtTitle').value = 'Dinner at Lemaire'; doc.getElementById('evtLocation').value = '101 W Franklin St, Richmond, VA 23220';
  doc.getElementById('eventForm').requestSubmit(); await settle();
  const saved = w.__testApp.getDocs().find(d => d.title === 'Dinner at Lemaire');
  assert.equal(saved.location, '101 W Franklin St, Richmond, VA 23220');
  assert.ok(![...doc.querySelectorAll('.home-week-event')].some(card => card.textContent.includes('Lemaire') && card.querySelector('.home-event-weather')));
  assert.deepEqual(errors, []);
});
test('event window: day chips, a clock to drag, the extras folded away', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('quickEvent').click(); await settle();
  const days=[...doc.querySelectorAll('#eventDays [data-event-date]')];
  assert.equal(days.length, 14); assert.equal(days[0].textContent, 'Today'); assert.equal(days[1].textContent, 'Tomorrow');
  assert.equal(days[0].getAttribute('aria-pressed'), 'true', 'a new event starts today');
  days[2].click(); await settle();
  const picked=new Date(); picked.setDate(picked.getDate()+2);
  assert.equal(doc.getElementById('evtStartDate').value, `${picked.getFullYear()}-${String(picked.getMonth()+1).padStart(2,'0')}-${String(picked.getDate()).padStart(2,'0')}`);
  assert.equal(doc.querySelector('#eventDays [data-event-date="2"]').getAttribute('aria-pressed'), 'true');
  // The clock shows the start, and AM/PM switches halves of the day.
  const readout=doc.querySelector('#eventDial .dial-readout'); assert.ok(readout && doc.querySelector('#eventDial .dial-dot.start') && doc.querySelector('#eventDial .dial-dot.end'));
  const before=doc.getElementById('evtStartTime').value, hour=Number(before.slice(0,2));
  doc.querySelector(`#eventDial [data-half="${hour < 12 ? 'PM' : 'AM'}"]`).click(); await settle();
  assert.equal(Number(doc.getElementById('evtStartTime').value.slice(0,2)), (hour + 12) % 24); assert.match(readout.textContent, hour < 12 ? /PM/ : /AM/);
  doc.querySelector('[data-event-duration="180"]').click(); await settle();
  assert.match(doc.getElementById('eventDateSummary').textContent, /3h/);
  // All day hides the clock and opens the exact dates.
  const allDay=doc.getElementById('evtAllDay'); allDay.checked=true; allDay.dispatchEvent(new w.Event('change', {bubbles:true})); await settle();
  assert.equal(doc.getElementById('eventDial').hidden, true); assert.equal(doc.getElementById('eventExact').open, true);
  // Extras are folded for a new event; Frankie is a chip next to the people.
  assert.equal(doc.getElementById('eventMore').open, false);
  assert.ok(doc.querySelector('.owner-chips #evtWithFrankie'), '+ Frankie sits with the who chips');
  assert.ok(doc.getElementById('saveBtnTop').classList.contains('event-save-top'), 'one Save, at the bottom (the top one is styled away)');
  assert.deepEqual(errors, []);
});
test('Settings shows whether Huckleberry, Publix and the email are working, and Today warns when one stops', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const rows=[...doc.querySelectorAll('#healthPanel .health-list li')];
  assert.deepEqual(rows.map(li => li.className), ['health-ok', 'health-ok', 'health-ok']);
  assert.match(doc.getElementById('healthPanel').textContent, /Huckleberry.*Working · last checked/s);
  assert.doesNotMatch(doc.getElementById('nowNext').textContent, /⚠/, 'nothing to warn about');
  w.dispatchEvent(new w.CustomEvent('hh:health', { detail:[{ service:'huckleberry', name:'Huckleberry', problem:'unreachable', since:new Date(Date.now() - 3600000).toISOString(), text:'Huckleberry hasn’t answered since 1:00 PM.' }] }));
  assert.match(doc.getElementById('nowNext').textContent, /⚠Huckleberrynot answering since/);
  assert.deepEqual(errors, []);
});
test('Got a hunch? Typed words are tested on the spot, and ones it can’t test are saved for Claude', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.querySelector('[data-view="frankie"]').click(); await settle();
  const text = doc.getElementById('hunchText'), list = doc.getElementById('hunchList');
  assert.match(list.textContent, /sleeps longer on bath nights/); assert.match(list.textContent, /Saved for Claude/, 'the preview has one of each');
  text.value = 'Afternoon naps are shorter'; text.dispatchEvent(new w.Event('input', { bubbles:true }));
  assert.equal(doc.getElementById('hunchFactor').value, 'afternoon'); assert.equal(doc.getElementById('hunchOutcome').value, 'napLength'); assert.equal(doc.getElementById('hunchDirection').value, 'less');
  assert.match(doc.getElementById('hunchRead').textContent, /Testing: When it’s an afternoon nap, the nap is shorter/);
  doc.getElementById('hunchForm').requestSubmit(); await settle();
  assert.match(doc.getElementById('hunchResult').textContent, /Looks true|Maybe|No real difference|opposite|Not enough/);
  assert.match(list.textContent, /Afternoon naps are shorter/); assert.equal(text.value, '');
  // Can't place it: saved for Claude, with the words and her logs ready to copy.
  text.value = 'She’s happier when the cats are napping too'; text.dispatchEvent(new w.Event('input', { bubbles:true }));
  assert.equal(doc.getElementById('hunchSubmit').textContent, 'Save it for Claude');
  doc.getElementById('hunchForm').requestSubmit(); await settle();
  assert.match(doc.getElementById('hunchResult').textContent, /Saved for Claude/);
  const copy = [...list.querySelectorAll('[data-hunch-copy]')].find(b => b.closest('li').textContent.includes('cats are napping'));
  copy.click(); await settle();
  const pasted = doc.querySelector('#hunchResult textarea')?.value || '';
  assert.match(pasted, /Hunch: "She’s happier when the cats are napping too"/); assert.match(pasted, /Nights \(/);
  // Delete.
  list.querySelector('li [data-hunch-delete]').click(); await settle();
  assert.doesNotMatch(list.textContent, /cats are napping/);
  assert.deepEqual(errors, []);
});
test('Where box: suggestions as you type (places used before, then towns) and the weather there', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  doc.getElementById('quickEvent').click(); await settle();
  const box = doc.getElementById('evtLocation'), list = doc.getElementById('evtLocationList'), line = doc.getElementById('evtLocationWeather');
  box.focus(); box.value = 'Na'; box.dispatchEvent(new w.Event('input', { bubbles:true }));
  await new Promise(r => setTimeout(r, 400)); await settle();
  const options = [...list.querySelectorAll('.place-option')];
  assert.equal(list.hidden, false); assert.equal(box.getAttribute('aria-expanded'), 'true');
  assert.equal(options[0].textContent.includes('Used before'), true, 'the sample weekend away in Nags Head comes first');
  assert.ok(options.some(o => /Naples/.test(o.textContent) && /mi away/.test(o.textContent)), 'then matching towns');
  box.dispatchEvent(new w.KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true })); box.dispatchEvent(new w.KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true }));
  assert.equal(box.value, 'Nags Head, NC'); assert.equal(list.hidden, true);
  await new Promise(r => setTimeout(r, 120)); await settle();
  assert.match(line.textContent, /° in Nags Head/);
  box.value = 'Carytown'; box.dispatchEvent(new w.Event('input', { bubbles:true })); await new Promise(r => setTimeout(r, 700));
  assert.match(line.textContent, /Richmond area/);
  assert.deepEqual(errors, []);
});
test('logging windows: drag bars set the time, the amount, how long she slept and each pump side', async t => {
  const {dom,w,doc,errors}=await fixture(); t.after(() => dom.window.close());
  const drag = (id, value) => { const s = doc.getElementById(id); s.value = String(value); s.dispatchEvent(new w.Event('input', { bubbles:true })); };
  const minutesAgo = id => Math.round((Date.now() - new Date(doc.getElementById(id).value)) / 60000);
  // Bottle: drag the time back 45 minutes and the amount to 3.5 oz.
  doc.querySelector('#view-today [data-baby-log="bottle"]').click();
  drag('babyLogStartAgo', -45);
  const near = (got, want) => assert.ok(Math.abs(got - want) <= 1, `${got} vs ${want}`); // times are kept to the minute
  near(minutesAgo('babyLogStart'), 45); assert.equal(doc.getElementById('babyLogStart').closest('.log-custom-time').hidden, true, 'no exact-time box needed');
  assert.match(doc.getElementById('babyLogStartText').textContent, /45m ago|45 min/);
  drag('babyLogAmountSlider', 3.5);
  assert.equal(doc.getElementById('babyLogAmount').value, '3.5'); assert.equal(doc.getElementById('babyLogSave').textContent, 'Save 3.5 oz bottle');
  // Chips and steppers move the bars too; ml changes the bar's range.
  doc.querySelector('[data-step="1"]').click(); assert.equal(doc.getElementById('babyLogAmountSlider').value, '4');
  doc.getElementById('babyLogUnits').value = 'ml'; doc.getElementById('babyLogUnits').dispatchEvent(new w.Event('input', { bubbles:true }));
  assert.equal(doc.getElementById('babyLogAmountSlider').max, '300'); assert.equal(doc.getElementById('babyLogAmountSlider').step, '5');
  doc.getElementById('babyLogClose').click();
  // Finished sleep: woke 10 minutes ago, slept 1h 15m.
  doc.querySelector('#view-today [data-baby-log="sleep-log"]').click();
  drag('babyLogEndAgo', -10); drag('babyLogLength', 75);
  near(minutesAgo('babyLogEnd'), 10); near(minutesAgo('babyLogStart'), 85);
  assert.equal(doc.getElementById('babyLogSave').textContent, 'Save 1h 15m sleep');
  doc.querySelector('#babyLogLengths [data-length="120"]').click(); assert.equal(doc.getElementById('babyLogLength').value, '120', 'chips move the bar');
  doc.getElementById('babyLogClose').click();
  // Pump: one bar per side.
  doc.querySelector('[data-baby-log="pump"]').click();
  drag('babyLogLeftSlider', 1.75); drag('babyLogRightSlider', 3);
  assert.deepEqual([doc.getElementById('babyLogLeft').value, doc.getElementById('babyLogRight').value], ['1.75', '3']);
  assert.equal(doc.getElementById('babyLogSave').textContent, 'Save 4.75 oz pump');
  // Editing an old log at an exact time still shows the exact box.
  doc.getElementById('babyLogStart').value = (() => { const d = new Date(Date.now() - 6 * 3600000 - 7 * 60000); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })();
  doc.getElementById('babyLogStart').dispatchEvent(new w.Event('input', { bubbles:true }));
  assert.equal(doc.getElementById('babyLogStart').closest('.log-custom-time').hidden, false);
  assert.equal(doc.getElementById('babyLogStartAgo').value, '-240', 'the bar stops at its end');
  assert.deepEqual(errors, []);
});
