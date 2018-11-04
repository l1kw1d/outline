// @flow
import uuid from 'uuid';
import { URL } from 'url';
import { DataTypes, sequelize, Op } from '../sequelize';
import { publicS3Endpoint, uploadToS3FromUrl } from '../utils/s3';
import { RESERVED_SUBDOMAINS } from '../../shared/utils/domains';
import Collection from './Collection';
import User from './User';

const Team = sequelize.define(
  'team',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: DataTypes.STRING,
    subdomain: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isLowercase: true,
        is: {
          args: [/^[a-z\d-]+$/, 'i'],
          msg: 'Must be only alphanumeric and dashes',
        },
        len: {
          args: [4, 32],
          msg: 'Must be between 4 and 32 characters',
        },
        notIn: {
          args: [RESERVED_SUBDOMAINS],
          msg: 'You chose a restricted word, please try another.',
        },
      },
      unique: true,
    },
    slackId: { type: DataTypes.STRING, allowNull: true },
    googleId: { type: DataTypes.STRING, allowNull: true },
    avatarUrl: { type: DataTypes.STRING, allowNull: true },
    sharing: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    slackData: DataTypes.JSONB,
  },
  {
    getterMethods: {
      url() {
        if (!this.subdomain) return process.env.URL;

        const url = new URL(process.env.URL);
        url.host = `${this.subdomain}.${url.host}`;
        return url.href.replace(/\/$/, '');
      },
    },
  }
);

Team.associate = models => {
  Team.hasMany(models.Collection, { as: 'collections' });
  Team.hasMany(models.Document, { as: 'documents' });
  Team.hasMany(models.User, { as: 'users' });
};

const uploadAvatar = async model => {
  const endpoint = publicS3Endpoint();

  if (model.avatarUrl && !model.avatarUrl.startsWith(endpoint)) {
    try {
      const newUrl = await uploadToS3FromUrl(
        model.avatarUrl,
        `avatars/${model.id}/${uuid.v4()}`
      );
      if (newUrl) model.avatarUrl = newUrl;
    } catch (err) {
      // we can try again next time
      console.error(err);
    }
  }
};

Team.prototype.createFirstCollection = async function(userId) {
  return await Collection.create({
    name: 'General',
    description: 'Your first Collection',
    type: 'atlas',
    teamId: this.id,
    creatorId: userId,
  });
};

Team.prototype.addAdmin = async function(user: User) {
  return user.update({ isAdmin: true });
};

Team.prototype.removeAdmin = async function(user: User) {
  const res = await User.findAndCountAll({
    where: {
      teamId: this.id,
      isAdmin: true,
      id: {
        // $FlowFixMe
        [Op.ne]: user.id,
      },
    },
    limit: 1,
  });
  if (res.count >= 1) {
    return user.update({ isAdmin: false });
  } else {
    throw new Error('At least one admin is required');
  }
};

Team.prototype.suspendUser = async function(user: User, admin: User) {
  if (user.id === admin.id)
    throw new Error('Unable to suspend the current user');
  return user.update({
    suspendedById: admin.id,
    suspendedAt: new Date(),
  });
};

Team.prototype.activateUser = async function(user: User, admin: User) {
  return user.update({
    suspendedById: null,
    suspendedAt: null,
  });
};

Team.beforeSave(uploadAvatar);

export default Team;
