const Sentry = require('@sentry/node');


exports.init = function () {
  Sentry.init({ dsn: process.env.SentryDSN_URL });
  Sentry.init({
    ignoreErrors: [
      'Non-Error exception captured',
    ],
  });
};

exports.logInfo = function (message) {
  Sentry.captureMessage(message);
};

exports.logException = function (error) {
  Sentry.captureException(error);
};
