const { Telegraf } = require('telegraf');

const db = require('../db/db');
const districts = require('../assets/districts.json');

const bot = new Telegraf(process.env.BOT_TOKEN);

const handleOnboarding = (ctx) => {
  db.searchUserByTelegramId(ctx.chat.id)
    .then((res) => {
      if (res) {
        const greeting = res.telegram_username ? res.telegram_username : res.telegram_id;
        ctx.reply(`Hello, ${greeting} - I already know you. Send /help to know possible options.`);
      } else {
        ctx.reply('Please wait while I register you');
        db.registerUser({ telegramId: ctx.chat.id, telegramUsername: ctx.chat.username })
          .then(() => {
            ctx.replyWithHTML(`
            Registered you! Send <em>/setPreference</em> to proceed.
            `);
          })
          .catch((err) => {
            console.error(err);
            ctx.reply('An error occured while registering you :( Please come back later!');
          });
      }
    })
    .catch((err) => {
      console.error(err);
      ctx.reply('Oops, an error occured while fetching your details, come back later ?');
    });
};

const handleDistrictSearch = (ctx) => {
  if (ctx.message.text.split(' ').length < 2)
    return ctx.reply('Send your query in format /searchDistrict <district name>');

  const district = String(ctx.message.text).split(' ')[1];
  ctx.reply(`Searching district ID for ${district}`);

  const districtIds = Object.keys(districts);
  const matchingResults = [];
  for (let i = 0; i < districtIds.length; i++) {
    const dId = districtIds[i];
    const d = districts[dId];

    if (String(d.name).toLowerCase().includes(String(district).toLowerCase())) matchingResults.push(d);
  }

  if (!matchingResults.length) ctx.reply('No matching district found, try a different spelling ?');
  else {
    let msg = `Found following districts,`;

    matchingResults.splice(0, 5).forEach((district) => {
      msg += `
      <strong>${district.name} - ${district.id} </strong>`;
    });

    msg += `Send /setPreference to learn how to set the district as search criteria`;

    ctx.replyWithHTML(msg);
  }
};

const handleSearchPreferenceSet = (ctx) => {
  if (ctx.message.text.split(' ').length < 3)
    return ctx.reply(
      'Send your query in format /setSearch <PIN|DISTRICT> <PIN NUMBER|DISTRICT ID>. Send /searchDistrict to find your district ID.'
    );

  const type = String(ctx.message.text).split(' ')[1].toUpperCase();
  const value = String(ctx.message.text).split(' ')[2];

  if (!type || !['PIN', 'DISTRICT'].includes(type)) {
    ctx.reply('Invalid TYPE - it should either be PIN or DISTRICT');
  } else if (
    !value ||
    Number.isNaN(value) ||
    (type === 'PIN' && value.length !== 6) ||
    (type === 'DISTRICT' && !districts[value])
  ) {
    ctx.reply(
      `Invalid VALUE ${value} received. Value should be a number. In case of PIN, it should be 6 digit PIN code.
        In case of district it should be a valid district ID. Send /setPreference to learn more.`
    );
  } else {
    db.setPreference({
      telegramId: ctx.chat.id,
      searchClass: type,
      searchValue: value,
    })
      .then(() => {
        ctx.reply('Your search preference have been saved. Send /status for more.');
      })
      .catch((err) => {
        console.error(err);
        ctx.reply('Unable to save your search preference, please try again later.');
      });
  }
};

const handleAgeCriteriaSet = (ctx) => {
  if (ctx.message.text.split(' ').length < 2) return ctx.reply('Send your preference in format /setAge <0|18|45>');

  const ageCriteria = Number.parseInt(ctx.message.text.split(' ')[1]);
  if (Number.isNaN(ageCriteria) || ![0, 18, 45].includes(ageCriteria))
    ctx.reply(
      'Invalid age criteria received, send 18 for 18-44 and 45 for 45+ vaccination. Send 0 if you want to be reminded for both'
    );
  else {
    db.setAgeCriteria({ telegramId: ctx.chat.id, ageCriteria })
      .then(() => {
        ctx.reply('Your age criteria has been saved. Send /status for more');
      })
      .catch((err) => {
        console.error(err);
        ctx.reply('Unable to save your age criteria preference, please try again later.');
      });
  }
};

const handleStatusShow = (ctx) => {
  db.searchUserByTelegramId(ctx.chat.id)
    .then((res) => {
      if (!res) ctx.reply(" I haven't seen you before. Send /start to register yourself.");
      else if (!res.search_class || !res.search_value)
        ctx.reply(`You haven't set your vaccination search criteria. Send /setPreference to know more.`);
      else if (res.age_criteria === null || Number.isNaN(res.age_criteria))
        ctx.replyWithHTML(
          `You haven't set vaccination age preference. Send <u>/setAge 18</u> for 18-44, and <u>/setAge 45</u> for 45+. Send <u>/setAge 0</u> for both`
        );
      else {
        ctx.replyWithHTML(`Here is what I know about you,
          telegram_id: ${res.telegram_id},
          search criteria: ${res.search_class} - ${res.search_value} ${
          res.search_class === 'DISTRICT' ? `(${districts[res.search_value].name})` : ''
        } ,
          age criteria: ${res.age_criteria} ${Number(res.age_criteria) === '0' ? 'Both 18+ and 45+' : '+'},
          send notification: ${res.active ? 'Yes' : 'No'},
          last queried(UTC): ${res.last_queried},
          last queried status: ${res.last_queried_status},
          query failure count: ${res.query_fail_count},
          total reminders sent: ${res.reminders_sent}
          `);
      }
    })
    .catch((err) => {
      console.error(err);
      ctx.reply('Error fetching the status. Please try again later.');
    });
};

const botService = () => {
  bot.start((ctx) => {
    handleOnboarding(ctx);
  });

  bot.command('setPreference', (ctx) => {
    ctx.replyWithHTML(`
      Send  <u><em>/setSearch <strong>type</strong> <strong>value</strong></em></u> - where <u>type</u> is either <strong>PIN</strong>
      or <strong>DISTRICT</strong> and <u>value</u> is either PIN number, in case of <strong>PIN</strong>, or district ID in case of <strong>DISTRICT</strong>. 

      To find your your district ID, send <em>/searchDistrict <u>district name</u></em>.

      For example, if you want to know CoWid Slots for Hyderabad, send <em>/setSearch DISTRICT 581</em> 
      Or if you want to be reminded of CoWid Slots for PIN 560005, send <em>/setSearch PIN 560005</em>

      After setting search and age preference, you should get a notification as soon as a slot is available
    `);
  });

  bot.command('searchDistrict', (ctx) => {
    handleDistrictSearch(ctx);
  });

  bot.command('setSearch', (ctx) => {
    handleSearchPreferenceSet(ctx);
  });

  bot.command('setAge', (ctx) => {
    handleAgeCriteriaSet(ctx);
  });

  bot.command('status', (ctx) => {
    handleStatusShow(ctx);
  });

  bot.command('pause', (ctx) => {
    db.setSubscriptionStatus({ telegramId: ctx.chat.id, status: false })
      .then(() => {
        ctx.reply('Your vaccination slot notification has been paused. Send /resume to restart');
      })
      .catch((err) => {
        console.error(err);
        ctx.reply('Unable to pause notification. Try again later');
      });
  });

  bot.command('resume', (ctx) => {
    db.setSubscriptionStatus({ telegramId: ctx.chat.id, status: true })
      .then(() => {
        ctx.reply('Your vaccination slot notification has been restarted. Send /pause to pause it.');
      })
      .catch((err) => {
        console.error(err);
        ctx.reply('Unable to restart notification. Try again later');
      });
  });

  bot.command('help', (ctx) => {
    ctx.reply(
      'Send /start to register yourself. Send /setPreference to learn how to set search criteria. Send /status to check vaccination query status. Send /pause if you do not want to be notified anymore. Send /resume if you want to resume notification status.'
    );
  });
};

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports.tgBot = bot;
module.exports.botService = botService;
