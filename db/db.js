const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(path.join(__dirname, 'db.db'));

const registerUser = ({ telegramId, telegramUsername }) => {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO users(telegram_id, telegram_username) VALUES($telegram_id, $telegram_username)',
      {
        $telegram_id: telegramId,
        $telegram_username: telegramUsername,
      },
      (err) => {
        if (err) return reject(err);
        return resolve();
      }
    );
  });
};

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

const setPreference = ({ telegramId, searchClass, searchValue }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET search_class = $search_class,
      search_value = $search_value
      
      WHERE telegram_id = $telegram_id`,
      {
        $telegram_id: telegramId,
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

const setAgeCriteria = ({ telegramId, ageCriteria }) => {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users
      SET age_criteria = $age_criteria
      
      WHERE telegram_id = $telegram_id`,
      {
        $telegram_id: telegramId,
        $age_criteria: ageCriteria,
      },
      (err) => {
        if (err) return reject(err);
        return resolve();
      }
    );
  });
};

module.exports.registerUser = registerUser;
module.exports.searchUserByTelegramId = searchUserByTelegramId;
module.exports.setPreference = setPreference;
module.exports.setAgeCriteria = setAgeCriteria;
