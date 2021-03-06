const mongoose = require('mongoose');
const moment = require('moment-timezone');
const _ = require('lodash');
const userProfile = require('../models/userProfile');
const badge = require('../models/badge');
const myteam = require('../helpers/helperModels/myTeam');
const dashboardhelper = require('../helpers/dashboardhelper')();
const reporthelper = require('../helpers/reporthelper')();

const emailSender = require('../utilities/emailSender');

const logger = require('../startup/logger');

let timeoutMS = 200000;

const userhelper = function () {
  const getTeamMembers = function (user) {
    const userid = mongoose.Types.ObjectId(user._id);
    // var teamid = userdetails.teamId;
    return myteam.findById(userid).select({
      'myteam._id': 1,
      'myteam.role': 1,
      'myteam.fullName': 1,
      _id: 0,
    });
  };

  const getUserName = async function (userId) {
    const userid = mongoose.Types.ObjectId(userId);
    return userProfile.findById(userid, 'firstName lastName');
  };

  const validateprofilepic = function (profilePic) {
    const picParts = profilePic.split('base64');
    let result = true;
    const errors = [];

    if (picParts.length < 2) {
      return {
        result: false,
        errors: 'Invalid image',
      };
    }

    // validate size
    const imagesize = picParts[1].length;
    const sizeInBytes = (4 * Math.ceil(imagesize / 3) * 0.5624896334383812) / 1024;

    if (sizeInBytes > 50) {
      errors.push('Image size should not exceed 50KB');
      result = false;
    }

    const imagetype = picParts[0].split('/')[1];
    if (imagetype !== 'jpeg;' && imagetype !== 'png;') {
      errors.push('Image type shoud be either jpeg or png.');
      result = false;
    }

    return {
      result,
      errors,
    };
  };

  const getInfringmentEmailBody = function (firstName, lastName, infringment, totalInfringements) {
    const text = `Dear <b>${firstName} ${lastName}</b>,
        <p>Oops, it looks like something happened and you’ve managed to get a blue square.</p>
        <p><b>Date Assigned:</b> ${infringment.date}</p>
        <p><b>Description:</b> ${infringment.description}</p>
        <p><b>Total Infringements:</b> This is your <b>${moment.localeData().ordinal(totalInfringements)}</b> blue square of 5.</p>
        <p>Life happens and we understand that. That’s why we allow 5 of them before taking action. This action usually includes removal from our team though, so please let your direct supervisor know what happened and do your best to avoid future blue squares if you are getting close to 5 and wish to avoid termination. Each blue square drops off after a year.</p>
        <p>Thank you,<br />
        One Community</p>`;

    return text;
  };


  /**
   * This function will send out an email listing all users that have a summary provided for a specific week.
   * A week is represented by an weekIndex: 0, 1 or 2, where 0 is the most recent and 2 the oldest.
   * It relies on the function weeklySummaries(startWeekIndex, endWeekIndex) to get the weekly summaries for the specific week.
   * In this case both the startWeekIndex and endWeekIndex are set to 1 to get the last weeks' summaries for all users.
   *
   * @param {int} weekIndex Numbered representation of a week where 0 is the most recent and 2 the oldest.
   *
   * @return {void}
   */
  const emailWeeklySummariesForAllUsers = function (weekIndex) {
    logger.logInfo(
      `Job for emailing all users' weekly summaries starting at ${moment().tz('America/Los_Angeles').format()}`,
    );

    weekIndex = (weekIndex !== null) ? weekIndex : 1;

    reporthelper
      .weeklySummaries(weekIndex, weekIndex)
      .then((results) => {
        let emailBody = '<h2>Weekly Summaries for all active users:</h2>';
        const weeklySummaryNotProvidedMessage = '<div><b>Weekly Summary:</b> Not provided!</div>';

        results.forEach((result) => {
          const {
            firstName, lastName, weeklySummaries, mediaUrl, weeklySummariesCount,
          } = result;

          const mediaUrlLink = mediaUrl ? `<a href="${mediaUrl}">${mediaUrl}</a>` : 'Not provided!';
          const totalValidWeeklySummaries = weeklySummariesCount || 'No valid submissions yet!';
          let weeklySummaryMessage = weeklySummaryNotProvidedMessage;
          // weeklySummaries array should only have one item if any, hence weeklySummaries[0] needs be used to access it.
          if (Array.isArray(weeklySummaries) && weeklySummaries.length && weeklySummaries[0]) {
            const { dueDate, summary } = weeklySummaries[0];
            if (summary) {
              weeklySummaryMessage = `<p><b>Weekly Summary</b> (for the week ending on ${moment(dueDate).tz('America/Los_Angeles').format('YYYY-MM-DD')}):</p>
                                        <div style="padding: 0 20px;">${summary}</div>`;
            }
          }

          emailBody += `\n
          <div style="padding: 20px 0; margin-top: 5px; border-bottom: 1px solid #828282;">
          <b>Name:</b> ${firstName} ${lastName}
          <p><b>Media URL:</b> ${mediaUrlLink}</p>
          <p><b>Total Valid Weekly Summaries:</b> ${totalValidWeeklySummaries}</p>
          ${weeklySummaryMessage}
          </div>`;
        });
        if (process.env.sendEmail) {
          emailSender(
            'onecommunityglobal@gmail.com',
            'Weekly Summaries for all active users...',
            emailBody,
            null,
          );
        }
      })
      .catch(error => logger.logException(error));
  };


  /**
   * This function will process the weeklySummaries array in the following way:
   *  1 ) Push a new (blank) summary at the beginning of the array.
   *  2 ) Always maintains 3 items in the array where each item represents a summary for a given week.
   *
   * This function will also increment the weeklySummariesCount by 1 if the user had provided a valid summary.
   *
   * @param {ObjectId} personId This is mongoose.Types.ObjectId object.
   * @param {boolean} hasWeeklySummary Whether the user with personId has submitted a valid weekly summary.
   */
  const processWeeklySummariesByUserId = function (personId, hasWeeklySummary) {
    userProfile
      .findByIdAndUpdate(personId, {
        $push: {
          weeklySummaries: {
            $each: [
              {
                dueDate: moment().tz('America/Los_Angeles').endOf('week'),
                summary: '',
              },
            ],
            $position: 0,
            $slice: 3,
          },
        },
      })
      .then(() => {
        if (hasWeeklySummary) {
          userProfile
            .findByIdAndUpdate(personId, {
              $inc: { weeklySummariesCount: 1 },
            }, { new: true })
            .catch(error => logger.logException(error));
        }
      })
      .catch(error => logger.logException(error));
  };

  /**
   * This function is called by a cron job to do 3 things to all active users:
   *  1 ) Determine whether there's been an infringement for the weekly summary for last week.
   *  2 ) Determine whether there's been an infringement for the time not met for last week.
   *  3 ) Call the processWeeklySummariesByUserId(personId) to process the weeklySummaries array
   *      and increment the weeklySummariesCount for valud submissions.
   */
  const assignBlueSquareforTimeNotMet = function () {
    timeoutMS = 200000;
    logger.logInfo(
      `Job for assigning blue square for commitment not met starting at ${moment()
        .tz('America/Los_Angeles')
        .format()}`,
    );
    const pdtStartOfLastWeek = moment()
      .tz('America/Los_Angeles')
      .startOf('week')
      .subtract(1, 'week');
    const pdtEndOfLastWeek = moment()
      .tz('America/Los_Angeles')
      .endOf('week')
      .subtract(1, 'week');
    userProfile
      .find(
        {
          isActive: true,
        },
        '_id weeklySummaries',
      )
      .then((users) => {
        users.forEach(async (user) => {
          const {
            _id, weeklySummaries,
          } = user;
          const personId = mongoose.Types.ObjectId(_id);

          let hasWeeklySummary = false;
          if (Array.isArray(weeklySummaries) && weeklySummaries.length) {
            const { summary } = weeklySummaries[0];
            // const fromDate = moment(pdtStartOfLastWeek).toDate();
            // const toDate = moment(pdtEndOfLastWeek).toDate();
            if (summary) {
              hasWeeklySummary = true;
            }
          }

          //  This needs to run AFTER the check for weekly summary above because the summaries array will be updated/shifted after this function runs.
          await processWeeklySummariesByUserId(personId, hasWeeklySummary);

          await dashboardhelper
            .laborthisweek(personId, pdtStartOfLastWeek, pdtEndOfLastWeek)
            .then(async (results) => {
              const { weeklyComittedHours, timeSpent_hrs: timeSpent } = results[0];
              const timeNotMet = (timeSpent < weeklyComittedHours);
              let description;

              await userProfile
                .findByIdAndUpdate(personId, {
                  $inc: {
                    totalTangibleHrs: timeSpent || 0,
                  },
                  $max: {
                    personalBestMaxHrs: timeSpent || 0,
                  },
                  $push: {
                    savedTangibleHrs: { $each: [timeSpent || 0], $slice: -200 },
                  },
                  $set: {
                    lastWeekTangibleHrs: timeSpent || 0,
                  },
                }, { new: true }).then((res) => {
                  const cutOffDate = moment()
                    .subtract(1, 'year')
                    .format('YYYY-MM-DD');
                  const oldInfringements = [];
                  for (let i = 0; i < res.infringments.length; i += 1) {
                    if (moment(res.infringements[i].date).diff(cutOffDate) >= 0) {
                      oldInfringements.push(res.infringements[i]);
                    } else {
                      break;
                    }
                  }
                  if (oldInfringements.length) {
                    userProfile
                      .findByIdAndUpdate(personId, {
                        $push: {
                          oldInfringements: { $each: oldInfringements, $slice: -10 },
                        },
                      }, { new: true });
                  }
                });

              if (timeNotMet || !hasWeeklySummary) {
                if (timeNotMet && !hasWeeklySummary) {
                  description = `System auto-assigned infringement for two reasons: not meeting weekly volunteer time commitment as well as not submitting a weekly summary. For the hours portion, you logged ${timeSpent} hours against committed effort of ${weeklyComittedHours} hours in the week starting ${pdtStartOfLastWeek.format('dddd YYYY-MM-DD')} and ending ${pdtEndOfLastWeek.format('dddd YYYY-MM-DD')}.`;
                } else if (timeNotMet) {
                  description = `System auto-assigned infringement for not meeting weekly volunteer time commitment. You logged ${timeSpent} hours against committed effort of ${weeklyComittedHours} hours in the week starting ${pdtStartOfLastWeek.format('dddd YYYY-MM-DD')} and ending ${pdtEndOfLastWeek.format('dddd YYYY-MM-DD')}.`;
                } else {
                  description = `System auto-assigned infringement for not submitting a weekly summary for the week starting ${pdtStartOfLastWeek.format('dddd YYYY-MM-DD')} and ending ${pdtEndOfLastWeek.format('dddd YYYY-MM-DD')}.`;
                }

                const infringment = {
                  date: moment()
                    .utc()
                    .format('YYYY-MM-DD'),
                  description,
                };

                await userProfile
                  .findByIdAndUpdate(personId, {
                    $push: {
                      infringments: infringment,
                    },
                  }, { new: true })
                  .then((status) => {
                    console.log(status);
                    if (process.env.sendEmail) {
                      timeoutMS += 500;
                      setTimeout(() => {
                        emailSender(
                          status.email,
                          'New Infringment Assigned',
                          getInfringmentEmailBody(
                            status.firstName,
                            status.lastName,
                            infringment,
                            status.infringments.length,
                          ),
                          null,
                          'onecommunityglobal@gmail.com',
                        );
                      }, timeoutMS);
                    }
                  })
                  .catch(error => logger.logException(error));
              }
            })
            .catch(error => logger.logException(error));


          await dashboardhelper
            .laborThisWeekByCategory(personId, pdtStartOfLastWeek, pdtEndOfLastWeek)
            .then(async (categories) => {
              if (Array.isArray(categories) && categories.length > 0) {
                await userProfile
                  .findOneAndUpdate({ _id: personId, categoryTangibleHrs: { $exists: false } },
                    { $set: { categoryTangibleHrs: [] } });
              } else {
                return;
              }
              categories.forEach(async (elem) => {
                if (elem._id == null) {
                  elem._id = 'Other';
                }
                await userProfile
                  .findOneAndUpdate({ _id: personId, 'categoryTangibleHrs.category': elem._id },
                    { $inc: { 'categoryTangibleHrs.$.hrs': elem.timeSpent_hrs } }, { new: true }).then(async (result) => {
                    if (!result) {
                      await userProfile
                        .findOneAndUpdate({ _id: personId, 'categoryTangibleHrs.category': { $ne: elem._id } },
                          { $addToSet: { categoryTangibleHrs: { category: elem._id, hrs: elem.timeSpent_hrs } } });
                    }
                  });
              });
            });
        });
      })
      .catch(error => logger.logException(error));

    // processWeeklySummaries for nonActive users
    userProfile
      .find(
        {
          isActive: false,
        },
        '_id',
      )
      .then((users) => {
        users.forEach(async (user) => {
          const {
            _id,
          } = user;
          const personId = mongoose.Types.ObjectId(_id);
          await processWeeklySummariesByUserId(personId, false);
        });
      });
  };

  const deleteBlueSquareAfterYear = function () {
    logger.logInfo(
      `Job for deleting blue squares older than 1 year starting at ${moment()
        .tz('America/Los_Angeles')
        .format()}`,
    );
    const cutOffDate = moment()
      .subtract(1, 'year')
      .format('YYYY-MM-DD');
    userProfile
      .updateMany(
        {},
        {
          $pull: {
            infringments: {
              date: {
                $lte: cutOffDate,
              },
            },
          },
        },
      )
      .then(results => logger.logInfo(results))
      .catch(error => logger.logException(error));
  };

  const reActivateUser = function () {
    logger.logInfo(
      `Job for activating users based on scheduled re-activation date starting at ${moment().tz('America/Los_Angeles').format()}`,
    );
    userProfile
      .find({ isActive: false, reactivationDate: { $exists: true } }, '_id isActive reactivationDate')
      .then((users) => {
        users.forEach((user) => {
          if (moment.tz(moment(), 'America/Los_Angeles').isSame(moment.tz(user.reactivationDate, 'UTC'), 'day')) {
            userProfile.findByIdAndUpdate(
              user._id,
              {
                $set: {
                  isActive: true,
                },
              }, { new: true },
            )
              .then(() => {
                logger.logInfo(`User with id: ${user._id} was re-acticated at ${moment().tz('America/Los_Angeles').format()}.`);
              })
              .catch(error => logger.logException(error));
          }
        });
      })
      .catch(error => logger.logException(error));
  };

  const notifyInfringments = function (
    original,
    current,
    firstName,
    lastName,
    emailAddress,
  ) {
    if (!current) return;
    const newOriginal = original.toObject();
    const newCurrent = current.toObject();
    const totalInfringements = newCurrent.length;
    let newInfringments = [];
    newInfringments = _.differenceWith(
      newCurrent,
      newOriginal,
      (arrVal, othVal) => arrVal._id.equals(othVal._id),
    );
    newInfringments.forEach((element) => {
      if (process.env.sendEmail) {
        emailSender(
          emailAddress,
          'New Infringment Assigned',
          getInfringmentEmailBody(firstName, lastName, element, totalInfringements),
          null,
          'onecommunityglobal@gmail.com',
        );
      }
    });
  };

  const replaceBadge = async function (personId, oldBadgeId, newBadgeId) {
    console.log('Replacing Badge', personId, oldBadgeId, newBadgeId);
    userProfile.updateOne({ _id: personId, 'badgeCollection.badge': oldBadgeId },
      { $set: { 'badgeCollection.$.badge': newBadgeId, 'badgeCollection.$.lastModified': Date.now().toString(), 'badgeCollection.$.count': 1 } },
      (err) => {
        if (err) {
          console.log(err);
        }
      });
  };

  const increaseBadgeCount = async function (personId, badgeId) {
    console.log('Increase Badge Count', personId, badgeId);
    userProfile.updateOne({ _id: personId, 'badgeCollection.badge': badgeId },
      { $inc: { 'badgeCollection.$.count': 1 }, $set: { 'badgeCollection.$.lastModified': Date.now().toString() } },
      (err) => {
        if (err) {
          console.log(err);
        }
      });
  };

  const changeBadgeCount = async function (personId, badgeId, count) {
    console.log('Changing Badge Count', personId, badgeId, count);
    userProfile.updateOne({ _id: personId, 'badgeCollection.badge': badgeId },
      { $set: { 'badgeCollection.$.count': count, 'badgeCollection.$.lastModified': Date.now().toString() } },
      (err) => {
        if (err) {
          console.log(err);
        }
      });
  };

  const addBadge = async function (personId, badgeId, count = 1, featured = false) {
    console.log('Adding Badge ', personId, badgeId, count);
    userProfile.findByIdAndUpdate(personId,
      {
        $push:
        {
          badgeCollection: {
            badge: badgeId, count, featured, lastModified: Date.now().toString(),
          },
        },
      }, (err) => {
        if (err) {
          console.log(err);
        }
      });
  };

  const removeDupBadge = async function (personId, badgeId) {
    console.log('Removing Badge ', personId, badgeId);
    userProfile.findByIdAndUpdate(personId,
      {
        $pull:
        {
          badgeCollection: { badge: badgeId },
        },
      }, (err) => {
        if (err) {
          console.log(err);
        }
      });
  };

  //   'No Infringement Streak',
  const checkNoInfringementStreak = async function (personId, user, badgeCollection) {
    let badgeOfType;
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'No Infringement Streak') {
        if (badgeOfType && badgeOfType.months <= badgeCollection[i].badge.months) {
          removeDupBadge(personId, badgeOfType._id);
          badgeOfType = badgeCollection[i].badge;
        } else if (badgeOfType && badgeOfType.months > badgeCollection[i].badge.months) {
          removeDupBadge(personId, badgeCollection[i].badge._id);
        } else if (!badgeOfType) {
          badgeOfType = badgeCollection[i].badge;
        }
      }
    }
    await badge.find({ type: 'No Infringement Streak' })
      .sort({ months: -1 })
      .then((results) => {
        if (!Array.isArray(results) || !results.length) {
          return;
        }

        results.every((elem) => {
          // Cannot account for time paused yet
          if (elem.months <= 12) {
            if (moment().diff(moment(user.createdDate), 'months', true) >= elem.months) {
              if (user.infringments.length === 0 || Math.abs(moment().diff(moment(user.infringments[user.infringments?.length - 1].date), 'months', true)) >= elem.months) {
                if (badgeOfType) {
                  if (badgeOfType._id.toString() !== elem._id.toString()) {
                    replaceBadge(personId, mongoose.Types.ObjectId(badgeOfType._id), mongoose.Types.ObjectId(elem._id));
                  }
                  return false;
                }
                addBadge(personId, mongoose.Types.ObjectId(elem._id));
                return false;
              }
            }
          } else if (user.infringements.length === 0) {
            if (moment().diff(moment(user.createdDate), 'months', true) >= elem.months) {
              if (user.oldInfringments.length === 0 || Math.abs(moment().diff(moment(user.oldInfringments[user.oldInfringments?.length - 1].date), 'months', true)) >= (elem.months - 12)) {
                if (badgeOfType) {
                  if (badgeOfType._id.toString() !== elem._id.toString()) {
                    replaceBadge(personId, mongoose.Types.ObjectId(badgeOfType._id), mongoose.Types.ObjectId(elem._id));
                  }
                  return false;
                }
                addBadge(personId, mongoose.Types.ObjectId(elem._id));
                return false;
              }
            }
          }
          return true;
        });
      });
  };

  // 'Minimum Hours Multiple',
  const checkMinHoursMultiple = async function (personId, user, badgeCollection) {
    const badgesOfType = [];
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'Minimum Hours Multiple') {
        badgesOfType.push(badgeCollection[i].badge);
      }
    }
    await badge.find({ type: 'Minimum Hours Multiple' })
      .sort({ multiple: -1 })
      .then((results) => {
        if (!Array.isArray(results) || !results.length) {
          return;
        }

        results.forEach((elem) => {
          if ((user.lastWeekTangibleHrs / user.weeklyComittedHours) >= elem.multiple) {
            let theBadge;
            for (let i = 0; i < badgesOfType.length; i += 1) {
              if (badgesOfType[i]._id.toString() === elem._id.toString()) {
                theBadge = badgesOfType[i]._id;
                break;
              }
            }

            if (theBadge) {
              increaseBadgeCount(personId, mongoose.Types.ObjectId(theBadge));
            } else {
              addBadge(personId, mongoose.Types.ObjectId(elem._id));
            }
          }
        });
      });
  };

  // 'Personal Max',
  const checkPersonalMax = async function (personId, user, badgeCollection) {
    let badgeOfType;
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'Personal Max') {
        if (badgeOfType) {
          removeDupBadge(personId, badgeOfType._id);
          badgeOfType = badgeCollection[i].badge;
        } else if (!badgeOfType) {
          badgeOfType = badgeCollection[i].badge;
        }
      }
    }
    await badge.findOne({ type: 'Personal Max' })
      .then((results) => {
        if (user.lastWeekTangibleHrs && user.lastWeekTangibleHrs === user.personalBestMaxHrs) {
          if (badgeOfType) {
            changeBadgeCount(personId, mongoose.Types.ObjectId(badgeOfType._id), user.personalBestMaxHrs);
          } else {
            addBadge(personId, mongoose.Types.ObjectId(results._id), user.personalBestMaxHrs);
          }
        }
      });
  };

  // 'Most Hrs in Week'
  const checkMostHrsWeek = async function (personId, user, badgeCollection) {
    let badgeOfType;
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'Most Hrs in Week') {
        badgeOfType = badgeCollection[i].badge;
      }
    }
    await badge.findOne({ type: 'Most Hrs in Week' })
      .then((results) => {
        userProfile.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: 1, maxHours: { $max: '$lastWeekTangibleHrs' } } },
        ]).then((userResults) => {
          if (user.lastWeekTangibleHrs && user.lastWeekTangibleHrs >= userResults[0].maxHours) {
            if (badgeOfType) {
              increaseBadgeCount(personId, mongoose.Types.ObjectId(badgeOfType._id));
            } else {
              addBadge(personId, mongoose.Types.ObjectId(results._id));
            }
          }
        });
      });
  };

  // 'X Hours for X Week Streak',
  const checkXHrsForXWeeks = async function (personId, user, badgeCollection) {
    // Handle Increasing the 1 week streak badges
    const badgesOfType = [];
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'X Hours for X Week Streak') {
        badgesOfType.push(badgeCollection[i].badge);
      }
    }
    await badge.find({ type: 'X Hours for X Week Streak', weeks: 1 })
      .sort({ totalHrs: -1 })
      .then((results) => {
        results.every((elem) => {
          if (elem.totalHrs <= user.lastWeekTangibleHrs) {
            let theBadge;
            for (let i = 0; i < badgesOfType.length; i += 1) {
              if (badgesOfType[i]._id.toString() === elem._id.toString()) {
                theBadge = badgesOfType[i]._id;
                break;
              }
            }
            if (theBadge) {
              increaseBadgeCount(personId, mongoose.Types.ObjectId(theBadge));
              return false;
            }
            addBadge(personId, mongoose.Types.ObjectId(elem._id));
            return false;
          }
          return true;
        });
      });
    // Check each Streak Greater than One to check if it works
    await badge.aggregate([
      { $match: { type: 'X Hours for X Week Streak', weeks: { $gt: 1 } } },
      { $sort: { weeks: -1, totalHrs: -1 } },
      { $group: { _id: '$weeks', badges: { $push: { _id: '$_id', hrs: '$totalHrs', weeks: '$weeks' } } } },
    ])
      .then((results) => {
        results.forEach((streak) => {
          streak.badges.every((bdge) => {
            let badgeOfType;
            for (let i = 0; i < badgeCollection.length; i += 1) {
              if (badgeCollection[i].badge?.type === 'X Hours for X Week Streak' && badgeCollection[i].badge?.weeks === bdge.weeks) {
                if (badgeOfType && badgeOfType.totalHrs <= badgeCollection[i].badge.totalHrs) {
                  removeDupBadge(personId, badgeOfType._id);
                  badgeOfType = badgeCollection[i].badge;
                } else if (badgeOfType && badgeOfType.totalHrs > badgeCollection[i].badge.totalHrs) {
                  removeDupBadge(personId, badgeCollection[i].badge._id);
                } else if (!badgeOfType) {
                  badgeOfType = badgeCollection[i].badge;
                }
              }
            }
            if (user.savedTangibleHrs.length >= bdge.weeks) {
              let awardBadge = true;
              const endOfArr = user.savedTangibleHrs.length - 1;
              for (let i = endOfArr; i >= (endOfArr - bdge.weeks + 1); i -= 1) {
                if (user.savedTangibleHrs[i] < bdge.hrs) {
                  awardBadge = false;
                  return true;
                }
              }
              if (awardBadge) {
                if (badgeOfType && badgeOfType.totalHrs < bdge.hrs) {
                  replaceBadge(personId, mongoose.Types.ObjectId(badgeOfType._id), mongoose.Types.ObjectId(bdge._id));
                } else if (!badgeOfType) {
                  addBadge(personId, mongoose.Types.ObjectId(bdge._id));
                } else if (badgeOfType && badgeOfType.totalHrs === bdge.hrs) {
                  increaseBadgeCount(personId, mongoose.Types.ObjectId(badgeOfType._id));
                }
                return false;
              }
            }
            return true;
          });
        });
      });
  };

  // 'Lead a team of X+'
  const checkLeadTeamOfXplus = async function (personId, user, badgeCollection) {
    if (!['Manager', 'Administrator', 'Core Team'].includes(user.role)) {
      return;
    }
    let teamMembers;
    await getTeamMembers({
      _id: personId,
    }).then((results) => {
      if (results) {
        teamMembers = results.myteam;
      } else {
        teamMembers = [];
      }
    });

    let badgeOfType;
    for (let i = 0; i < badgeCollection.length; i += 1) {
      if (badgeCollection[i].badge?.type === 'Lead a team of X+') {
        if (badgeOfType && badgeOfType.people <= badgeCollection[i].badge.people) {
          removeDupBadge(personId, badgeOfType._id);
          badgeOfType = badgeCollection[i].badge;
        } else if (badgeOfType && badgeOfType.people > badgeCollection[i].badge.people) {
          removeDupBadge(personId, badgeCollection[i].badge._id);
        } else if (!badgeOfType) {
          badgeOfType = badgeCollection[i].badge;
        }
      }
    }

    await badge.find({ type: 'Lead a team of X+' })
      .sort({ people: -1 })
      .then((results) => {
        if (!Array.isArray(results) || !results.length) {
          return;
        }

        results.every((elem) => {
          if (teamMembers.length >= elem.people) {
            if (badgeOfType) {
              if (badgeOfType._id.toString() !== elem._id.toString() && badgeOfType.people < elem.people) {
                replaceBadge(personId, mongoose.Types.ObjectId(badgeOfType._id), mongoose.Types.ObjectId(elem._id));
              }
              return false;
            }
            addBadge(personId, mongoose.Types.ObjectId(elem._id));
            return false;
          }
          return true;
        });
      });
  };

  // 'Total Hrs in Category'
  const checkTotalHrsInCat = async function (personId, user, badgeCollection) {
    const categoryTangibleHrs = user.categoryTangibleHrs || [];
    const categories = ['Food', 'Energy', 'Housing', 'Education', 'Society', 'Economics', 'Stewardship'];
    if (categoryTangibleHrs.length === 0) {
      return;
    }

    categories.forEach(async (category) => {
      const categoryHrs = categoryTangibleHrs.find(elem => elem.category === category);
      let badgeOfType;
      for (let i = 0; i < badgeCollection.length; i += 1) {
        if (badgeCollection[i].badge?.type === 'Total Hrs in Category' && badgeCollection[i].badge?.category === category) {
          if (badgeOfType && badgeOfType.totalHrs <= badgeCollection[i].badge.totalHrs) {
            removeDupBadge(personId, badgeOfType._id);
            badgeOfType = badgeCollection[i].badge;
          } else if (badgeOfType && badgeOfType.totalHrs > badgeCollection[i].badge.totalHrs) {
            removeDupBadge(personId, badgeCollection[i].badge._id);
          } else if (!badgeOfType) {
            badgeOfType = badgeCollection[i].badge;
          }
        }
      }
      await badge.find({ type: 'Total Hrs in Category', category })
        .sort({ totalHrs: -1 })
        .then((results) => {
          if (!Array.isArray(results) || !results.length || !categoryHrs) {
            return;
          }

          results.every((elem) => {
            if (categoryHrs.hrs >= elem.totalHrs) {
              if (badgeOfType) {
                if (badgeOfType._id.toString() !== elem._id.toString() && badgeOfType.totalHrs < elem.totalHrs) {
                  replaceBadge(personId, mongoose.Types.ObjectId(badgeOfType._id), mongoose.Types.ObjectId(elem._id));
                }
                return false;
              }
              addBadge(personId, mongoose.Types.ObjectId(elem._id));
              return false;
            }
            return true;
          });
        });
    });
  };

  const awardNewBadges = async function () {
    // getBadges User Has By Type
    await userProfile
      .find(
        {
          isActive: true,
        },
      ).populate('badgeCollection.badge')
      .then((users) => {
        users.forEach(async (user) => {
          const {
            _id, badgeCollection,
          } = user;
          const personId = mongoose.Types.ObjectId(_id);
          await checkNoInfringementStreak(personId, user, badgeCollection);
          await checkMinHoursMultiple(personId, user, badgeCollection);
          await checkPersonalMax(personId, user, badgeCollection);
          await checkMostHrsWeek(personId, user, badgeCollection);
          await checkLeadTeamOfXplus(personId, user, badgeCollection);
          await checkTotalHrsInCat(personId, user, badgeCollection);
          await checkXHrsForXWeeks(personId, user, badgeCollection);
        });
      });
  };

  return {
    getUserName,
    getTeamMembers,
    validateprofilepic,
    assignBlueSquareforTimeNotMet,
    deleteBlueSquareAfterYear,
    reActivateUser,
    notifyInfringments,
    getInfringmentEmailBody,
    emailWeeklySummariesForAllUsers,
    awardNewBadges,
  };
};

module.exports = userhelper;
