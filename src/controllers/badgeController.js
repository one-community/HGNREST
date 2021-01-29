const mongoose = require('mongoose');
const UserProfile = require('../models/userProfile');

const badgeController = function (Badge) {
  const getAllBadges = function (req, res) {
    const AuthorizedRolesToView = ['Administrator'];

    const userId = mongoose.Types.ObjectId(req.params.userId);

    UserProfile.findById(userId, 'role')
      .then((user) => {
        const isRequestorAuthorized = !!AuthorizedRolesToView.includes(
          user.role,
        );

        if (!isRequestorAuthorized) {
          res.status(403).send('You are not authorized to view all badge data.');
        }
      })
      .catch((error) => {
        res.status(404).send(error);
      });

    Badge.find(
      {},
      'badgeName imageUrl category project ranking description',
    ).populate({
      path: 'project',
      select: '_id projectName',
    })
      .sort({
        badgeName: 1,
      })
      .then(results => res.status(200).send(results))
      .catch(error => res.status(404).send(error));
  };

  const assignBadges = function (req, res) {
    const AuthorizedRolesToView = ['Administrator'];

    const { requestorId } = req.body;

    UserProfile.findById(requestorId, 'role')
      .then((user) => {
        const isRequestorAuthorized = !!AuthorizedRolesToView.includes(
          user.role,
        );

        if (!isRequestorAuthorized) {
          res.status(403).send('You are not authorized to assign badges.');
        }
      })
      .catch((error) => {
        res.status(404).send(error);
      });

    const userToBeAssigned = mongoose.Types.ObjectId(req.params.userId);

    UserProfile.findById(userToBeAssigned, (error, record) => {
      if (error || record === null) {
        res.status(400).send('Can not find the user to be assigned.');
        return;
      }
      record.badgeCollection = req.body.badgeCollection;

      record.save()
        .then(results => res.status(201).send(results._id))
        .catch(errors => res.status(400).send(errors));
    });
  };

  return {
    getAllBadges,
    assignBadges,
  };
};

module.exports = badgeController;