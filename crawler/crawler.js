const moment = require('moment-timezone');
const fetch = require('node-fetch');

const db = require('../db/db');
const { tgBot } = require('../bot/bot');

const districts = require('../assets/districts.json');

const CRON_INTERVAL = 15 * 60 * 1000;

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
  const result = {
    above45Found: false,
    above45Slots: {},
    above45SlotsCount: 0,
    under45Found: false,
    under45Slots: {},
    under45SlotsCount: 0,
  };

  return new Promise((resolve, reject) => {
    if (typeof slotData.centers === 'undefined' || !Array.isArray(slotData.centers))
      return reject('Invalid `centers` data found');

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
          const date = session.date;
          const minAge = session.min_age_limit;
          const vaccine = session.vaccine;

          if (availableCapacity) {
            const slotData = {
              centerDetails,
              date,
              availableCapacity,
              minAge,
              vaccine,
            };

            if (minAge < 45) {
              result.under45Found = true;
              result.under45SlotsCount += 1;

              // if date key doesn't exist, create it
              if (!result.under45Slots[date]) result.under45Slots[date] = [];
              result.under45Slots[date].push(slotData);
            } else {
              result.above45Found = true;
              result.above45SlotsCount += 1;

              // if date key doesn't exist, create it
              if (!result.above45Slots[date]) result.above45Slots[date] = [];
              result.above45Slots[date].push(slotData);
            }
          }
        });
      }
    });

    return resolve(result);
  });
};

const sendSlotNotification = async (item, slots, ageCriteria) => {
  try {
    const tgReceipients = await db.getNotificationReceipients({
      searchClass: item.search_class,
      searchValue: item.search_value,
      ageCriteria,
    });

    const msgHeader = `Found available vaccine slots for age <strong>${ageCriteria}</strong> and area type <strong>${
      item.search_class
    } - ${item.search_value}${
      item.search_class === 'DISTRICT' ? `(${districts[item.search_value].name})` : ''
    }</strong>,\n`;
    const msgFooter = '\nSend /pause to pause further notifications';
    const dates = Object.keys(slots).sort(); // ['03-01-2021', '10-01-2021', ...]
    const slotsByDates = {}; // { '03-01-2021': [{}, {}], ... }

    for (const date of dates) {
      const slotText = [];

      for (const slot of slots[date]) {
        slotText.push(`
          Center: ${slot.centerDetails.centerName}
          Fee: ${slot.centerDetails.feeType || ''}
          PINCODE: ${slot.centerDetails.pincode}
          Min. age: ${slot.minAge}
          Capacity: ${slot.availableCapacity}${slot.vaccine ? `\n          Vaccine: ${slot.vaccine}` : ''}
          --------------------`);
      }

      slotsByDates[date] = slotText;
    }

    // Generating msg content
    let msgContent = msgHeader;
    dates.forEach((date) => {
      const dateHeader = `\nDate: <strong>${date}</strong>,\n`;
      const dateWarning =
        slotsByDates[date].length > 10
          ? `<em>${slotsByDates[date].length} slots available for this date. Showing only first 10</em>`
          : '';
      const dateFooter = '';

      const dateBody = slotsByDates[date].splice(0, 10).join('\n');

      msgContent += dateHeader + dateWarning + dateBody + dateFooter;
    });
    msgContent += msgFooter;

    for (const receipient of tgReceipients) {
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
          console.error('Message content: ', msgContent);
        });
    }
  } catch (e) {
    console.error(`Error notifying telegram receipients`);
    console.error(e);
  }
};

const fetchCenterData = (items, date) => {
  for (const item of items) {
    fetchSlotDetails(item.search_value, item.search_class, date)
      .then((data) => {
        console.info(`Received data for ${JSON.stringify(item)}`);
        db.updateQueryStatus({ searchClass: item.search_class, searchValue: item.search_value });

        skimSlotDetails(data)
          .then((result) => {
            if (result.above45Found || result.under45Found)
              console.info(
                `Found some slots (Under 45: ${result.under45SlotsCount}, Above 45: ${
                  result.above45SlotsCount
                }) for  item ${JSON.stringify(item)} for date ${date}`
              );
            else console.info(`No slots found`);

            if (result.above45Found) sendSlotNotification(item, result.above45Slots, 45);
            if (result.under45Found) sendSlotNotification(item, result.under45Slots, 18);
          })
          .catch((err) => {
            console.error(`Error occured while skimming details for ${JSON.stringify(item)} : ${err}`);
          });
      })
      .catch((err) => {
        console.error(`Error fetching details for ${JSON.stringify(item)}: `, err);
        db.incrementFailureCount({ searchClass: item.search_class, searchValue: item.search_value });
      });
  }
};

const fetchDataForDate = async (date) => {
  console.info('Fetching data for', date);

  const pinItems = await db.getDistinctActiveItemsBySearchClass('pin');
  const districtItems = await db.getDistinctActiveItemsBySearchClass('district');

  fetchCenterData(pinItems, date);
  fetchCenterData(districtItems, date);

  console.info(`Got ${pinItems.length} items to crawl for PIN. ${districtItems.length} items to search by district`);
};

const crawler = async (dates) => {
  for (const date of dates) {
    try {
      fetchDataForDate(date);
    } catch (e) {
      console.error('Unhandled exception occured when fetching for date', date, ' :', e);
    }
  }
};

const main = () => {
  let w1 = moment().tz('Asia/Kolkata').format('DD-MM-YYYY').toString();
  let w2 = moment().tz('Asia/Kolkata').add(7, 'days').format('DD-MM-YYYY').toString();
  let w3 = moment().tz('Asia/Kolkata').add(14, 'days').format('DD-MM-YYYY').toString();

  // To make run immediately once
  crawler([w1, w2, w3]);

  setInterval(() => {
    w1 = moment().tz('Asia/Kolkata').format('DD-MM-YYYY').toString();
    w2 = moment().tz('Asia/Kolkata').add(7, 'days').format('DD-MM-YYYY').toString();
    w3 = moment().tz('Asia/Kolkata').add(14, 'days').format('DD-MM-YYYY').toString();
    crawler([w1, w2, w3]);
  }, CRON_INTERVAL);
};

module.exports = main;
module.exports.skimSlotDetails = skimSlotDetails;