const schedule = require('node-schedule');
const moment = require('moment-timezone');
const fetch = require('node-fetch');

const db = require('../db/db');
const { tgBot } = require('../bot/bot');

const districts = require('../assets/districts.json');

const FETCH_DELAY = 3000; // 3 seconds - CoWin API restricts 100 reqs per 5 minute(300 seconds).
const NOTIF_DELAY = 100; // 100ms
let queuActive = false;
let fetchStartedAt = new Date().getTime();

const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchSlotDetails = (searchValue, searchClass, date) => {
  let fetchUrl = '';
  if (searchClass === 'DISTRICT')
    fetchUrl = `https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByDistrict?district_id=${searchValue}&date=${date}`;
  else
    fetchUrl = `https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByPin?pincode=${searchValue}&date=${date}`;

  return new Promise((resolve, reject) => {
    fetch(fetchUrl, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:87.0) node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
      },
    })
      .then((resp) => resp.json())
      .then((data) => {
        console.info(`Fetched booking details via ${fetchUrl}`);
        return resolve(data);
      })
      .catch((err) => {
        console.error(`Failed to fetch details via ${fetchUrl}, because: ${err}`);
        return reject(err);
      });
  });
};

const skimSlotDetails = (slotData) => {
  const result = [];

  return new Promise((resolve, reject) => {
    if (typeof slotData.centers === 'undefined' || !Array.isArray(slotData.centers))
      return reject(`Invalid 'centers' data found: ${JSON.stringify(slotData.centers)}`);

    slotData.centers.forEach((center) => {
      const centerDetails = {
        centerId: center.center_id || null,
        centerName: center.name || null,
        pincode: center.pincode || null,
        feeType: center.fee_type || null,
      };

      if (center.sessions && Array.isArray(center.sessions)) {
        center.sessions.forEach((session) => {
          const availableCapacity = session.available_capacity;
          const dose1Capacity = session.available_capacity_dose1;
          const dose2Capacity = session.available_capacity_dose2;
          const date = session.date;
          const minAge = session.min_age_limit;
          const vaccine = session.vaccine;

          if (availableCapacity) {
            const slotData = {
              centerDetails,
              date,
              availableCapacity,
              dose1Capacity,
              dose2Capacity,
              minAge,
              vaccine,
            };

            result.push(slotData);
          }
        });
      }
    });

    return resolve(result);
  });
};

const sendSlotNotification = async ({ item, vaccine, age, dose, slots }) => {
  try {
    const tgReceipients = await db.getNotificationReceipients({
      searchClass: item.search_class,
      searchValue: item.search_value,
      ageCriteria: age,
      vaccineCriteria: String(vaccine).toUpperCase(),
      doseCriteria: dose,
    });

    const msgHeader = `Found available vaccine slots for age <strong>${ageCriteria}+</strong>, area type <strong>${
      item.search_class
    } - ${item.search_value}${
      item.search_class === 'DISTRICT' ? `(${districts[item.search_value].name})` : ''
    }</strong>, vaccine: <strong>${vaccine}</strong> and dose: <strong>Dose ${dose}</strong>,\n`;
    const msgFooter = '\nSend /pause to pause further notifications';

    const slotsByDates = {}; // { '03-01-2021': [{}, {}], ... }
    for (const slot of slots) {
      const slotDate = slot.date;
      if (!slotsByDates[slotDate]) slotsByDates[slotDate] = [];

      slotsByDates[slotDate].push(slot);
    }
    const dates = Object.keys(slotsByDates).sort(); // ['03-01-2021', '10-01-2021', ...]

    for (const date of dates) {
      const slotText = [];

      for (const slot of slots[date]) {
        slotText.push(`       Center: ${slot.centerDetails.centerName}
         Fee: ${slot.centerDetails.feeType || ''}
         PINCODE: ${slot.centerDetails.pincode}
         Capacity: ${slot.availableCapacity}
    --------------------`);
      }

      slotsByDates[date] = slotText;
    }

    // Generating msg content
    let msgContent = msgHeader;
    let showLimited = false;
    let maxSlotsPerDay = 10;
    if (slots.length > 70) {
      showLimited = true;
      maxSlotsPerDay = 3;
      msgContent += `\nYou have <strong>${slots.length}</strong> slots for next 14 days. We are showing only first three centers for each day. Please visit cowin.gov.in to see all the slots or use PINCODE instead of entire district. We can not show so many results.\n`;
    }

    let chunks = [];
    dates.forEach((date) => {
      if (msgContent.length > 2500) {
        chunks.push(msgContent);
        msgContent = '';
      }
      const dateHeader = `\n\nDate: <strong>${date}</strong>,\n`;
      const dateWarning =
        slotsByDates[date].length > 10 && !showLimited
          ? `<em>${slotsByDates[date].length} slots available for this date. Showing only first 10</em>\n`
          : '';
      const dateFooter = '';

      const dateBody = slotsByDates[date].splice(0, maxSlotsPerDay).join('\n');

      msgContent += dateHeader + dateWarning + dateBody + dateFooter;
    });

    if (!chunks.length) msgContent += msgFooter;
    else {
      chunks.push(msgContent);
      chunks[chunks.length - 1] += msgFooter;
    }

    for (const receipient of tgReceipients) {
      if (!chunks.length) {
        await delay(NOTIF_DELAY);
        tgBot.telegram
          .sendMessage(receipient.telegram_id, msgContent, { parse_mode: 'HTML' })
          .then(() => {
            console.info('Sent message to ', receipient.telegram_id);
            db.incrementReminderCount({
              telegramId: receipient.telegram_id,
              searchClass: item.search_class,
              searchValue: item.search_value,
            });
          })
          .catch((err) => {
            console.error('Failed to send message to', receipient.telegram_id, 'because: ', err);
            if (
              err &&
              err.response &&
              err.response.error_code === 403 &&
              err.response.description &&
              err.response.description === 'Forbidden: bot was blocked by the user'
            ) {
              // mark users subscription as inactive if failed to send message
              db.setSubscriptionStatus({ telegramId: receipient.telegram_id, status: 0 });
            }
          });
      } else {
        chunks.forEach(async (msg) => {
          await delay(NOTIF_DELAY);
          tgBot.telegram
            .sendMessage(receipient.telegram_id, msg, { parse_mode: 'HTML' })
            .then(() => {
              console.info('Sent chunked message to ', receipient.telegram_id);
              db.incrementReminderCount({
                telegramId: receipient.telegram_id,
                searchClass: item.search_class,
                searchValue: item.search_value,
              });
            })
            .catch((err) => {
              console.error('Failed to send chunked message to', receipient.telegram_id, 'because: ', err);
              if (
                err &&
                err.response &&
                err.response.error_code === 403 &&
                err.response.description &&
                err.response.description === 'Forbidden: bot was blocked by the user'
              ) {
                // mark users subscription as inactive if failed to send message
                db.setSubscriptionStatus({ telegramId: receipient.telegram_id, status: 0 });
              }
            });
        });
      }
    }
  } catch (e) {
    console.error(`Error notifying telegram receipients`);
    console.error(e);
  }
};

const dispatchSlotNotifications = (item, allSlots) => {
  sendSlotNotification({ item, vaccine: 'covaxin', age: 18, dose: 1, slots: allSlots.covaxin18PlusDose1 });
  sendSlotNotification({ item, vaccine: 'covaxin', age: 18, dose: 2, slots: allSlots.covaxin18PlusDose2 });
  sendSlotNotification({ item, vaccine: 'covaxin', age: 45, dose: 1, slots: allSlots.covaxin45PlusDose1 });
  sendSlotNotification({ item, vaccine: 'covaxin', age: 45, dose: 2, slots: allSlots.covaxin45PlusDose2 });

  sendSlotNotification({ item, vaccine: 'covishield', age: 18, dose: 1, slots: allSlots.covishield18PlusDose1 });
  sendSlotNotification({ item, vaccine: 'covishield', age: 18, dose: 2, slots: allSlots.covishield18PlusDose2 });
  sendSlotNotification({ item, vaccine: 'covishield', age: 45, dose: 1, slots: allSlots.covishield45PlusDose1 });
  sendSlotNotification({ item, vaccine: 'covishield', age: 45, dose: 2, slots: allSlots.covishield45PlusDose2 });
};

const fetchCenterData = (items, date) => {
  return new Promise(async (resolve) => {
    for (const item of items) {
      let timeSpentSinceLastFetch = new Date().getTime() - fetchStartedAt;
      if (timeSpentSinceLastFetch > FETCH_DELAY) timeSpentSinceLastFetch = FETCH_DELAY;
      await delay(FETCH_DELAY - timeSpentSinceLastFetch);
      fetchStartedAt = new Date().getTime();

      try {
        const data = await fetchSlotDetails(item.search_value, item.search_class, date);

        console.info(`Received data for ${JSON.stringify(item)}`);
        db.updateQueryStatus({ searchClass: item.search_class, searchValue: item.search_value });

        skimSlotDetails(data)
          .then((result) => {
            let slots = {
              covaxin18PlusDose1: [],
              covaxin18PlusDose2: [],
              covaxin45PlusDose1: [],
              covaxin45PlusDose2: [],

              covishield18PlusDose1: [],
              covishield18PlusDose2: [],
              covishield45PlusDose1: [],
              covishield45PlusDose2: [],
            };

            if (result.length) {
              for (const slot of result) {
                const dataKeyPrefix = `${String(slot.vaccine).trim().toLowerCase()}${slot.minAge}Plus`;
                if (slot.dose1Capacity) {
                  slots[`${dataKeyPrefix}Dose1`].push({
                    ...slot,
                    selectedCapacity: slot.dose1Capacity,
                  });
                }

                if (slot.dose2Capacity) {
                  slots[`${dataKeyPrefix}Dose2`].push({
                    ...slot,
                    selectedCapacity: slot.dose2Capacity,
                  });
                }
              }

              console.log(
                `Found some slots for item ${JSON.stringify(item)} for date ${date}:\n${JSON.stringify(slots)}`
              );

              dispatchSlotNotifications(item, slots);
            } else console.info(`No slots found for item ${JSON.stringify(item)} for date ${date}`);
          })
          .catch((err) => {
            console.error(`Error occured while skimming details for ${JSON.stringify(item)} : ${err}`);
          });
      } catch (err) {
        console.error(`Error fetching details for ${JSON.stringify(item)}: `, err);
        db.incrementFailureCount({ searchClass: item.search_class, searchValue: item.search_value });
      }
    }

    return resolve();
  });
};

const fetchDataForDate = (date) => {
  return new Promise(async (resolve) => {
    console.info('Fetching data for', date);
    const pinItems = await db.getDistinctActiveItemsBySearchClass('pin');
    const districtItems = await db.getDistinctActiveItemsBySearchClass('district');
    console.info(`Got ${pinItems.length} items to crawl for PIN. ${districtItems.length} items to search by district`);

    try {
      await fetchCenterData(pinItems, date);
    } catch (err) {
      console.error(`Failed fetching centerdata for ${JSON.stringify(pinItems)} for ${date}`, err);
    }

    try {
      await fetchCenterData(districtItems, date);
    } catch (err) {
      console.error(`Failed fetching centerdata for ${JSON.stringify(districtItems)} for ${date}`, err);
    }

    return resolve();
  });
};

const crawler = (dates) => {
  return new Promise(async (resolve) => {
    for (const date of dates) {
      try {
        await fetchDataForDate(date);
      } catch (e) {
        console.error('Unhandled exception occured when fetching for date', date, ' :', e);
      }
    }

    return resolve();
  });
};

const main = () => {
  let w1 = moment().tz('Asia/Kolkata').format('DD-MM-YYYY').toString();
  // let w2 = moment().tz('Asia/Kolkata').add(7, 'days').format('DD-MM-YYYY').toString();
  //let w3 = moment().tz('Asia/Kolkata').add(14, 'days').format('DD-MM-YYYY').toString();

  // To make run immediately once
  queuActive = true;
  crawler([w1])
    .catch(() => {})
    .finally(() => {
      queuActive = false;
    });

  const rule = new schedule.RecurrenceRule();
  rule.minute = new schedule.Range(0, 60, 5); // every 5 minutes

  const job = schedule.scheduleJob(rule, () => {
    console.info('Starting job');
    if (queuActive) {
      console.info('Previous job active...exiting');
      return;
    }

    w1 = moment().tz('Asia/Kolkata').format('DD-MM-YYYY').toString();
    w2 = moment().tz('Asia/Kolkata').add(7, 'days').format('DD-MM-YYYY').toString();
    //  w3 = moment().tz('Asia/Kolkata').add(14, 'days').format('DD-MM-YYYY').toString();

    queuActive = true;
    crawler([w1])
      .catch(() => {})
      .finally(() => {
        queuActive = false;
      });
  });
};

module.exports = main;
module.exports.skimSlotDetails = skimSlotDetails;
