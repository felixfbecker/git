const {pathExists} = require('fs-extra');
const {isUndefined, isPlainObject, isArray, template, castArray, uniq} = require('lodash');
const micromatch = require('micromatch');
const dirGlob = require('dir-glob');
const pReduce = require('p-reduce');
const debug = require('debug')('semantic-release:git');
const resolveConfig = require('./resolve-config');
const {getModifiedFiles, add, config, commit, push} = require('./git');

const CHANGELOG = 'CHANGELOG.md';
const PKG_JSON = 'package.json';
const PKG_LOCK = 'package-lock.json';
const SKW_JSON = 'npm-shrinkwrap.json';

/**
 * Publish a release commit including configurable files.
 *
 * @param {Object} pluginConfig The plugin configuration.
 * @param {String|Array<String>} [pluginConfig.assets] Files to include in the release commit. Can be files path or globs.
 * @param {String} [pluginConfig.message] The message for the release commit.
 * @param {String} [pluginConfig.gitUserName] The username to use for commiting (git `user.name` config).
 * @param {String} [pluginConfig.gitUserEmail] The email to use for commiting (git `user.email` config).
 * @param {Object} options `semantic-release` configuration.
 * @param {String} options.repositoryUrl The remote git repository URL.
 * @param {String} options.branch The remote branch to publish to.
 * @param {Object} logger Global logger.
 * @param {Object} lastRelease The last release.
 * @param {String} lastRelease.version The last release version.
 * @param {String} lastRelease.gitHead The commit sha corresponding to the last release.
 * @param {String} lastRelease.gitTag The tag corresponding to the last release.
 * @param {Object} nextRelease The next release.
 * @param {String} nextRelease.version The next release version.
 * @param {String} nextRelease.gitHead The commit sha of the head commit.
 * @param {String} nextRelease.gitTag The git tag to use to make the next release.
 * @param {Object} logger Global logger.
 */
module.exports = async (pluginConfig, {branch, repositoryUrl}, lastRelease, nextRelease, logger) => {
  const {gitUserEmail, gitUserName, message, assets} = resolveConfig(pluginConfig);
  const patterns = [];
  const modifiedFiles = await getModifiedFiles();

  if (isUndefined(assets) && (await pathExists(CHANGELOG))) {
    logger.log('Add %s to the release commit', CHANGELOG);
    patterns.push(CHANGELOG);
  }
  if (isUndefined(assets) && (await pathExists(PKG_JSON))) {
    logger.log('Add %s to the release commit', PKG_JSON);
    patterns.push(PKG_JSON);
  }
  if (isUndefined(assets) && (await pathExists(PKG_LOCK))) {
    logger.log('Add %s to the release commit', PKG_LOCK);
    patterns.push(PKG_LOCK);
  }
  if (isUndefined(assets) && (await pathExists(SKW_JSON))) {
    logger.log('Add %s to the release commit', SKW_JSON);
    patterns.push(SKW_JSON);
  }

  patterns.push(
    ...(assets || []).map(pattern => (!isArray(pattern) && isPlainObject(pattern) ? pattern.path : pattern))
  );

  const filesToCommit = uniq(
    await pReduce(
      patterns,
      async (result, pattern) => {
        const glob = castArray(pattern);
        let nonegate;
        // Skip solo negated pattern (avoid to include every non js file with `!**/*.js`)
        if (glob.length <= 1 && glob[0].startsWith('!')) {
          nonegate = true;
          debug(
            'skipping the negated glob %o as its alone in its group and would retrieve a large amount of files ',
            glob[0]
          );
        }
        result.push(...micromatch(modifiedFiles, await dirGlob(glob), {dot: true, nonegate}));
        return result;
      },
      []
    )
  );

  if (filesToCommit.length > 0) {
    logger.log('Found %d file(s) to commit', filesToCommit.length);
    await add(filesToCommit);
    await config('user.email', gitUserEmail);
    await config('user.name', gitUserName);
    debug('commited files: %o', filesToCommit);
    await commit(
      message
        ? template(message)({branch, lastRelease, nextRelease})
        : `chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}`
    );
  }

  logger.log('Creating tag %s', nextRelease.gitTag);
  await push(repositoryUrl, branch);
  logger.log('Published Git release: %s', nextRelease.gitTag);
};
