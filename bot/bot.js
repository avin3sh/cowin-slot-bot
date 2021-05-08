const { Telegraf } = require('telegraf');
const moment = require('moment-timezone');

const db = require('../db/db');
const districts = require('../assets/districts.json');

const bot = new Telegraf(process.env.BOT_TOKEN);

const handleIntro = (ctx) => {
  ctx.replyWithMarkdown(
    `Hi ${
      ctx.chat.first_name || ctx.chat.username || ctx.chat.id
    }, I am CoWin Slot bot. I check available vaccination slots in your area, every 30 to 60 minutes, and notify you as soon as a slot is available near you.

To enable notifications, you need to tell me your area and your age preference. This is a two step process:
*Steps to add an area *
1. Send \`/addarea PIN <pincode number>\` if you want me to monitor a pincode. For example, if your pincode is _560013_ then send \`/addarea PIN 560013\` 

You can also ask me to monitor entire district, for that send \`/addarea DISTRICT <district id>\`. If you do not know your district id, find it out using command \`/searchdistrict <district name>\`

2. Once you have specified area, you need to tell me whether you want to be notified for 18-44 vaccinations or 45+ vaccinations or both\. By default I assume you want to be notified for 18-44 vaccination slots.

if you want to be notified for just 18-44 vaccination slots then send \`/agelimit 18\`. If you want to be notified for 45+ vaccination slots, send \`/agelimit 45\`. If you want to be notified for both 18+ and 45+ vaccinations, send \`/agelimit all\`

*Adding multiple areas *
You can follow above two steps to add multiple areas for me to monitor. If you want to specify different age limit for different area, send \`/agelimit <all|18|45> <PIN|DISTRICT> <pincode|district id>\` where \`<pincode|district id>\` is pincode or district ID of area for which you want to specify the age limit. For example if you had added an area like \`/addarea PIN 560013\` and want to set age limit of 45+ for this area, then you should send \`/agelimit 45 PIN 560013\`.

*Verifying your status *
To verify your details that you have registered with me, send /status.

*Removing an area that you added *
if you want to remove an area that you added earlier, send \`/removearea <PIN|DISTRICT> <pincode|district id>\`

*Pausing notifcations *
if you want to pause all incoming notifications, send /pause. To resume notifications, send /resume.

For anything else, contact me on @trishuldealer`
  );
};

const handleDistrictSearch = (ctx) => {
  if (ctx.message.text.split(' ').length < 2)
    return ctx.replyWithMarkdown('Send your query in format `/searchdistrict <district name>`');

  const district = String(ctx.message.text).split(' ')[1];

  const districtIds = Object.keys(districts);
  const matchingResults = [];
  for (let i = 0; i < districtIds.length; i++) {
    const dId = districtIds[i];
    const d = districts[dId];

    if (String(d.name).toLowerCase().includes(String(district).toLowerCase())) matchingResults.push(d);
  }

  if (!matchingResults.length) ctx.reply('No matching district found, try a different spelling ?');
  else {
    let msg = `Found following districts,\n\ndistrict name - district id\n`;

    matchingResults.splice(0, 5).forEach((district) => {
      msg += `<strong>${district.name} - <u>${district.id}</u></strong>\n`;
    });

    msg += `\nSend /help to learn how to add an area for notification`;

    ctx.replyWithHTML(msg);
  }
};

const handleAddArea = async (ctx) => {
  try {
    const { area_count } = await db.getAddedAreaCount({ telegramId: ctx.chat.id });
    if (Number.parseInt(area_count) >= 5)
      return ctx.reply(
        `To prevent service abuse, you are only allowed to add maximum of 5 areas. Please remove an existing area using /removearea command before adding a new one.`
      );
  } catch (err) {
    console.error(err);
    return ctx.reply('A database error occured. Please try again later.');
  }

  if (ctx.message.text.split(' ').length < 3)
    return ctx.replyWithMarkdown(
      'Send your query in format `/addarea <PIN|DISTRICT> <pincode|district id>`. Send `/searchdistrict <district name>` to find the district ID. Send /help to learn more.'
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
    ctx.replyWithMarkdown(
      `Invalid VALUE ${value} received. Value should be a number. In case of PIN, it should be 6 digit PIN code.
        In case of district it should be a valid district ID. Send \`/searchdistrict <district name>\` to find the district ID. Send /help to learn more.`
    );
  } else {
    db.addArea({
      telegramId: ctx.chat.id,
      telegramUsername: ctx.chat.username,
      searchClass: type,
      searchValue: value,
    })
      .then(() => {
        ctx.reply(
          `Successfully added the area. Send /status to verify. Note: Default age criteria is 18-44. Use /agelimit to update age criteria for this area`
        );
      })
      .catch((err) => {
        console.error(err);
        if (err && err.code && err.code === 'SQLITE_CONSTRAINT')
          return ctx.reply('You have already added this area. Send /status to verify.');
        ctx.reply('Unable to add the area, try again later.');
      });
  }
};

const handleRemoveArea = (ctx) => {
  if (ctx.message.text.split(' ').length < 3)
    return ctx.replyWithMarkdown(
      'Send your query in format `/removearea <PIN|DISTRICT> <pincode|district id>`. Send `/status` to find the district ID that you saved earlier.'
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
    ctx.replyWithMarkdown(
      `Invalid VALUE ${value} received. Value should be a number. In case of PIN, it should be 6 digit PIN code.
        In case of district it should be a valid district ID. Send \`/status\` to verify the district ID that you have saved.`
    );
  } else {
    db.removeArea({
      telegramId: ctx.chat.id,
      searchClass: type,
      searchValue: value,
    })
      .then((affectedRows) => {
        if (!affectedRows)
          return ctx.reply('Are you sure you had added this area ? No changes to be made. Send /status to verify.');
        ctx.reply('Successfully removed the area. Send /status to verify');
      })
      .catch((err) => {
        console.error(err);
        ctx.reply('Unable to remove the area, try again later.');
      });
  }
};

const handleAgeCriteria = (ctx) => {
  let age = 'all';
  let isAreaSpecific = false;
  let searchClass = null;
  let searchValue = null;

  const params = ctx.message.text.split(' ');

  if (params.length < 2) {
    return ctx.replyWithMarkdown(
      'To set age limit preference, send `/agelimit <all|18|45>` or `/agelimit <all|18|45> <PIN|DISTRICT> <pincode|district id>`. Send /help to learn more'
    );
  } else {
    if (params[1].toLowerCase() !== 'all') age = Number(params[1]);
  }

  if (age === null || (age !== 'all' && Number.isNaN(age)) || !['all', 18, 45].includes(age))
    return ctx.reply('Invalid age value specified. Valid values are all, 18 and 45');

  if (params.length > 2) {
    if (params.length < 4)
      ctx.reply('Need 3 parameters - age, PIN/DISTRICT and pincode or district ID. Send /help to learn more');

    isAreaSpecific = true;
    searchClass = String(ctx.message.text).split(' ')[2].toUpperCase();
    searchValue = String(ctx.message.text).split(' ')[3];
  }

  if (!isAreaSpecific) {
    db.setAllAgeCriteria({ telegramId: ctx.chat.id, ageCriteria: age }).then((updatedRows) => {
      ctx.reply(`Updated age criteria for ${updatedRows} area${updatedRows > 1 ? 's' : ''}. Send /status to verify.`);
    });
  } else {
    if (!searchClass || !['PIN', 'DISTRICT'].includes(searchClass)) {
      ctx.reply('Invalid TYPE - it should either be PIN or DISTRICT');
    } else if (
      !searchValue ||
      Number.isNaN(searchValue) ||
      (searchClass === 'PIN' && searchValue.length !== 6) ||
      (searchClass === 'DISTRICT' && !districts[searchValue])
    ) {
      ctx.replyWithMarkdown(
        `Invalid VALUE ${searchValue} received. Area value should be a number. In case of PIN, it should be 6 digit PIN code.
          In case of district it should be a valid district ID. Send \`/searchdistrict <district name>\` to find the district ID. Send /help to learn more.`
      );
    } else {
      db.setAgeCriteriaByArea({
        telegramId: ctx.chat.id,
        ageCriteria: age,
        searchClass,
        searchValue,
      }).then(() => {
        ctx.reply(`Updated age criteria for the provided area. Send /status to verify.`);
      });
    }
  }
};

const handleStatusShow = (ctx) => {
  db.getAllAreasByUser(ctx.chat.id)
    .then((rows) => {
      if (!rows.length) ctx.reply("You haven't added any area yet. Send /help to get started.");
      else {
        let msgContent = `Hello ${
          ctx.chat.first_name || ctx.chat.username || ctx.chat.id
        }, here is list of areas I will notify you about when a vaccination slot is available,\n`;

        rows.forEach((area) => {
          msgContent += `
          Area: ${area.search_class} - ${area.search_value} ${
            area.search_class === 'DISTRICT' ? `(${districts[area.search_value].name})` : ''
          },
          Age criteria: ${area.age_criteria}${Number(area.age_criteria) === 0 ? ' (Both 18+ and 45+)' : '+'},
          Last checked: ${
            area.last_queried
              ? moment.utc(area.last_queried).tz('Asia/Kolkata').format('DD-MM-YYYY h:mm a').toString()
              : 'Not yet'
          },
          Last check status: ${area.last_queried_status},
          No. of failed queries: ${area.query_fail_count},
          Notifications sent: ${area.reminders_sent}
          --------------------
          `;
        });

        msgContent += `\nNotifications enabled: ${rows[0].active ? 'Yes' : 'No'}`;
        msgContent += '\n\nSend /help to learn more';

        ctx.reply(msgContent);
      }
    })
    .catch((err) => {
      console.error(err);
      ctx.reply('Error fetching the status. Please try again later.');
    });
};

const botService = () => {
  bot.command(['start', 'help'], (ctx) => {
    handleIntro(ctx);
  });

  bot.command(['searchDistrict', 'searchdistrict'], (ctx) => {
    handleDistrictSearch(ctx);
  });

  bot.command(['addarea', 'addArea'], (ctx) => {
    handleAddArea(ctx);
  });

  bot.command(['removearea', 'removeArea'], (ctx) => {
    handleRemoveArea(ctx);
  });

  bot.command(['agelimit', 'ageLimit'], (ctx) => {
    handleAgeCriteria(ctx);
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

  bot.command('announce', async (ctx) => {
    // listen to my @trishuldealer announcement messages
    if (Number(ctx.chat.id) === 123164342 && ctx.message.text.split(' ').length > 1) {
      try {
        const telegram_recepients = await db.getAllActiveUsers();
        ctx.reply(`Found ${telegram_recepients.length} receipients, sending them announcement`);

        telegram_recepients.forEach((tgReceipient) => {
          bot.telegram.sendMessage(tgReceipient.telegram_id, ctx.message.text.substr(10)).catch((err) => {
            console.error(`Couldn't send message  to ${tgReceipient.telegram_id}: `, err);
            if (
              err &&
              err.response &&
              err.response.error_code === 403 &&
              err.response.description &&
              err.response.description === 'Forbidden: bot was blocked by the user'
            ) {
              // mark users subscription as inactive if failed to send message
              db.setSubscriptionStatus({ telegramId: tgReceipient.telegram_id, status: 0 });
            }
          });
        });
      } catch (err) {
        console.error(err);
        ctx.reply('Unable to fetch all active receipients');
      }
    }
  });
};

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports.tgBot = bot;
module.exports.botService = botService;
