const moment = require('moment');
const fetch = require('node-fetch');

const db = require('../db/db');
const { tgBot } = require('../bot/bot');

const CRON_INTERVAL = 30 * 60 * 1000;

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
        Host: 'cdn-api.co-vin.in',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:87.0) Gecko/20100101 Firefox/87.0',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US, en; q = 0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        Origin: 'https://www.cowin.gov.in',
        Referer: 'https://www.cowin.gov.in',
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
    under45Found: false,
    under45Slots: {},
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

              // if date key doesn't exist, create it
              if (!result.under45Slots[date]) result.under45Slots[date] = [];
              result.under45Slots[date].push(slotData);
            } else {
              result.above45Found = true;

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

    let msg = `Found available vaccine slots for age <strong>${ageCriteria}</strong> and area type <strong>${item.search_class} - ${item.search_value}</strong>,

    `;

    const dates = Object.keys(slots).sort();

    for (const date of dates) {
      msg += `Date: <strong>${date}</strong>,`;
      for (const slot of slots[date]) {
        msg += `
          Center: ${slot.centerDetails.centerName}
          Fee: ${slot.centerDetails.feeType || ''}
          PINCODE: ${slot.centerDetails.pincode}
          Min. age: ${slot.minAge}
          Capacity: ${slot.availableCapacity}
          ${slot.vaccine ? `Vaccine: ${slot.vaccine}` : ''}
          --------------------`;
      }

      msg += '\n';
    }

    msg += 'Send /pause to pause further notifications';

    for (const receipient of tgReceipients) {
      tgBot.telegram.sendMessage(receipient.telegram_id, msg, { parse_mode: 'HTML' });
      console.info('Sent message to ', receipient.telegram_id);
      db.incrementReminderCount(receipient.telegram_id);
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
              console.info(`Found some slots for ${JSON.stringify(item)}`);
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
  const w1 = moment().format('DD-MM-YYYY').toString();
  const w2 = moment().add(7, 'days').format('DD-MM-YYYY').toString();
  const w3 = moment().add(14, 'days').format('DD-MM-YYYY').toString();

  // To make run immediately once
  crawler([w1, w2, w3]);

  setInterval(() => {
    crawler([w1, w2, w3]);
  }, CRON_INTERVAL);
};

module.exports = main;
module.exports.skimSlotDetails = skimSlotDetails;
