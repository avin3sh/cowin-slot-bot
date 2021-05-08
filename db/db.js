const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'db.db'));

const searchUserByTelegramId = (telegramId) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM users WHERE telegram_id = $telegram_id',
      {
        $telegram_id: telegramId,
      },
      (err, res) => {
        if (err) return reject(err);
        return resolve(res);
      }
    );
  });
};

const getAllAreasByUser = (telegramId) => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM users WHERE telegram_id = $telegram_id`,
      {
        $telegram_id: telegramId,
      },
      (err, res) => {
        if (err) return reject(err);
        return resolve(res);
      }
    );
  });
};

const getAllActiveUsers = () => {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT distinct telegram_id FROM users
    WHERE active = 1`,
      (err, results) => {
        if (err) return reject(err);
        return resolve(results);
      }
    );
  });
};

const addArea = ({ telegramId, telegramUsername, searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO users(telegram_id, telegram_username, search_class, search_value, age_criteria)
      VALUES($telegram_id, $telegram_username, $search_class, $search_value, $age_criteria)`,
      {
        $telegram_id: telegramId,
        $telegram_username: telegramUsername,
        $search_class: searchClass,
        $search_value: searchValue,
        $age_criteria: 18, // by default 18-44 vaccination slots
      },
      function (err) {
        if (err) return reject(err);
        return resolve(this.lastID);
      }
    );
  });
};

const getAddedAreaCount = ({ telegramId }) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT COUNT(*) AS area_count FROM users WHERE telegram_id = $telegram_id',
      {
        $telegram_id: telegramId,
      },
      (err, res) => {
        if (err) return reject(err);
        return resolve(res);
      }
    );
  });
};

const removeArea = ({ telegramId, searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM users
      WHERE telegram_id = $telegram_id
      AND search_class = $search_class
      AND search_value = $search_value`,
      {
        $telegram_id: telegramId,
        $search_class: searchClass,
        $search_value: searchValue,
      },
      function (err) {
        if (err) return reject(err);
        return resolve(this.changes);
      }
    );
  });
};

const setAllAgeCriteria = ({ telegramId, ageCriteria }) => {
  let ageValue = ageCriteria;
  if (ageCriteria === 'all') ageValue = 0;

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET age_criteria = $age_criteria
      
      WHERE telegram_id = $telegram_id`,
      {
        $telegram_id: telegramId,
        $age_criteria: ageValue,
      },
      function (err) {
        if (err) return reject(err);
        return resolve(this.changes);
      }
    );
  });
};

const setAgeCriteriaByArea = ({ telegramId, ageCriteria, searchClass, searchValue }) => {
  let ageValue = ageCriteria;
  if (ageCriteria === 'all') ageValue = 0;

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET age_criteria = $age_criteria
      
      WHERE telegram_id = $telegram_id
      AND search_class = $search_class
      AND search_value = $search_value`,
      {
        $telegram_id: telegramId,
        $age_criteria: ageValue,
        $search_class: searchClass,
        $search_value: searchValue,
      },
      function (err) {
        if (err) return reject(err);
        return resolve(this.changes);
      }
    );
  });
};

const setSubscriptionStatus = ({ telegramId, status }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET active = $active
      
      WHERE telegram_id = $telegram_id`,
      {
        $telegram_id: telegramId,
        $active: status ? 1 : 0,
      },
      (err) => {
        if (err) return reject(err);
        return resolve();
      }
    );
  });
};

const getDistinctActiveItemsBySearchClass = (searchClass) => {
  const sc = String(searchClass).toLowerCase() === 'pin' ? 'PIN' : 'DISTRICT';

  return new Promise((resolve, reject) => {
    db.all(
      `
    SELECT distinct search_class, search_value
    FROM users

    WHERE active = 1 
    AND age_criteria IS NOT NULL
    AND query_fail_count < 10
    AND search_class = $search_class

    ORDER BY search_value ASC
    `,
      {
        $search_class: sc,
      },
      (err, rows) => {
        if (err) return reject(err);
        return resolve(rows);
      }
    );
  });
};

const incrementFailureCount = ({ searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET query_fail_count = query_fail_count + 1,
      last_queried = CURRENT_TIMESTAMP,
      last_queried_status = 0
      
      WHERE search_class = $search_class
      AND search_value = $search_value`,
      {
        $search_class: searchClass,
        $search_value: searchValue,
      },
      (err) => {
        if (err) return reject(err);
        return resolve();
      }
    );
  });
};

const updateQueryStatus = ({ searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET last_queried = CURRENT_TIMESTAMP,
      last_queried_status = 1
      
      WHERE search_class = $search_class
      AND search_value = $search_value`,
      {
        $search_class: searchClass,
        $search_value: searchValue,
      },
      (err) => {
        if (err) return reject(err);
        return resolve();
      }
    );
  });
};

const getNotificationReceipients = ({ searchClass, searchValue, ageCriteria }) => {
  return new Promise((resolve, reject) => {
    db.all(
      `
    SELECT telegram_id FROM users
    WHERE search_class = $search_class
    AND search_value = $search_value
    AND age_criteria IS NOT NULL
    AND (age_criteria = 0 OR age_criteria = $age_criteria)
    AND active = 1
    `,
      {
        $search_class: searchClass,
        $search_value: searchValue,
        $age_criteria: ageCriteria,
      },
      (err, results) => {
        if (err) return reject(err);
        return resolve(results);
      }
    );
  });
};

const incrementReminderCount = ({ telegramId, searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET reminders_sent = reminders_sent + 1
      
      WHERE telegram_id = $telegram_id
      AND search_class = $search_class
      AND search_value = $search_value`,
      {
        $telegram_id: telegramId,
        $search_class: searchClass,
        $search_value: searchValue,
      },
      function (err) {
        if (err) return reject(err);
        return resolve(this.changes);
      }
    );
  });
};

module.exports.searchUserByTelegramId = searchUserByTelegramId;
module.exports.getAllAreasByUser = getAllAreasByUser;
module.exports.getAllActiveUsers = getAllActiveUsers;
module.exports.addArea = addArea;
module.exports.getAddedAreaCount = getAddedAreaCount;
module.exports.removeArea = removeArea;
module.exports.setAllAgeCriteria = setAllAgeCriteria;
module.exports.setAgeCriteriaByArea = setAgeCriteriaByArea;
module.exports.setSubscriptionStatus = setSubscriptionStatus;
module.exports.getDistinctActiveItemsBySearchClass = getDistinctActiveItemsBySearchClass;
module.exports.incrementFailureCount = incrementFailureCount;
module.exports.updateQueryStatus = updateQueryStatus;
module.exports.getNotificationReceipients = getNotificationReceipients;
module.exports.incrementReminderCount = incrementReminderCount;
