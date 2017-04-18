/**
 * affectedFiles
 * 
 * This program outputs a list of files affected by changes in other files that are in the former ones dependency tree.
 * The problem that inspired this program is to know what test files can be broken because of modifications on
 * another files in the code base. This way, we'll know the exact test files that we must run to check that
 * nothing breaks.
 * 
 * It needs a config file called `tree.config.json` with the next properties:
 * - testsFolder: the folder to build the dependency tree from. In our case, the specs folder.
 *   ex: "testsFolder": "lib/assets/core/test/spec/cartodb3/"
 * - filesRegex: the regular expression for knowing what files must be taken into account for building the dependency tree.
 *   ex: "filesRegex": "spec\\.js$"
 * - replacements: string replacements for file paths. Useful in our case because we copy files from one path to other in another
 *   process of our builind steps.
 *   ex:
 *     "replacements": [
 *       ["lib/assets/core", "lib/assets"],
 *       ["lib/assets/client", "lib/assets"]
 *     ]
 * 
 * Input: the program needs a list of files to check against. See example below for an explanation.
 * Output: it outputs the list of affected files between the tags <affected></affected>
 * 
 * Example:
 * Say we have two spec files in folder specs/ with its own dependencies.
 * 
 * spec/
 * +
 * |-- foo.spec.js - require('lib/component'), require('lib/calendar'), require('lib/tools/dropdown')
 * |
 * |-- baz.spec.js - require('lib/whatever'), require('lib/calendar')
 * 
 * Run 1: What spec files are affected by a change in files 'lib/tools/dropdown.js' and 'lib/common/utils.js'? (It's only required in foo.spec.js dependency tree)
 * > affectedFiles lib/tools/drowndown.js lib/common/utils.js
 *   output
 *   <affected>
 *   spec/foo.spec.js
 *   </affected>
 * 
 * Run 2: What spec files are affected by a change in file 'lib/calendar.js'? (It's required in both specs)
 * > affectedFiles lib/tools/calendar.js
 *   output
 *   <affected>
 *   spec/foo.spec.js
 *   spec/baz.spec.js
 *   </affected>
 */


var fs = require('fs-extra');
var colors = require('colors');
var recursive = require('recursive-readdir');
var minimist = require('minimist');
var Promise = require('bluebird');
var _ = require('underscore');
var FileTrie = require('./fileTrie');

var configFile = './tree.config.json';
var start = Date.now();
var trie = new FileTrie();
var error = false;
var config;

var addTrigger = function (triggers, currentTrigger, affectedSpecs) {
  if (!triggers[currentTrigger]) {
    triggers[currentTrigger] = [];
  }
  triggers[currentTrigger] = _.uniq(triggers[currentTrigger].concat(affectedSpecs));
  return triggers;
};

var logTriggers = function (triggers) {
  var keys = Object.keys(triggers);
  keys.forEach(function (key) {
    console.log('');
    console.log(colors.yellow(key));
    console.log(colors.yellow(new Array(key.length + 1).join('-')));
    triggers[key].forEach(function (trigger) {
      console.log(trigger);
    });
  });
};

var main = function (testsFolder, replacements, modifiedFiles, filesRegex) {
  filesRegex = filesRegex || 'spec\\.js$';

  var replaceFilePath = function (spec) {
    return replacements.reduce(function (acc, replacement) {
      return acc.replace(replacement[0], replacement[1]);
    }, spec);
  };

  var onlyTheseFiles = function (file, stats) {
    var theRegex = new RegExp(filesRegex);
    return !stats.isDirectory() && !theRegex.test(file);
  };

  recursive(testsFolder, [onlyTheseFiles], function (err, files) {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    if (!files || files.length === 0) {
      console.error('Spec files not found.');
      process.exit(1);
    }

    console.log('Found ' + files.length + ' spec files.');
    var allFilePromises = files.reduce(function (acc, file) {
      acc.push(trie.addFileRequires(file));
      return acc;
    }, []);
    Promise.all(allFilePromises)
      .then(function () {
        console.log('Dependency tree created.');
        console.log(colors.magenta('Took ' + (Date.now() - start)));

        console.log('Getting reverse spec dependencies...');

        var markStart = Date.now();
        files.forEach(function (file) {
          trie.markSubTree(file);
        });
        console.log(colors.magenta('Took ' + (Date.now() - markStart)));

        var specsInfo = _.chain(modifiedFiles)
          .reduce(function (acc, modifiedFile) {
            console.log(colors.magenta(acc.affectedSpecs.length));

            var node = trie.getNode(modifiedFile);
            if (node && node.marks && node.marks.length > 0) {
              acc.affectedSpecs = acc.affectedSpecs.concat(node.marks);
              acc.triggers = addTrigger(acc.triggers, modifiedFile, node.marks);
              return acc;
            }
            return acc;
          }, {
            affectedSpecs: [],
            triggers: {}
          })
          .value();

        var targetSpecs = _.uniq(specsInfo.affectedSpecs).map(function (spec) {
          return replaceFilePath(spec);
        });

        logTriggers(specsInfo.triggers);

        console.log('');
        console.log(colors.yellow('<affected>'));
        targetSpecs.forEach(function (spec) {
          console.log(spec);
        });
        console.log(colors.yellow('</affected>'));
      })
      .catch(function (reason) {
        console.error(colors.red(reason));
        process.exit(-1);
      });
  });
};

// Read configuration & run program
try {
  if (fs.statSync(configFile)) {
    config = fs.readJsonSync(configFile);
    if (!config.testsFolder) {
      console.error('`testsFolder` not found in config file.');
      error = true;
    } else if (!config.replacements) {
      console.error('`replacements` not found in config file.');
      error = true;
    } else {
      var modifiedFiles = minimist(process.argv.slice(2))._;
      main(config.testsFolder, config.replacements, modifiedFiles, config.filesRegex);
    }

    if (error) {
      process.exit(1);
    }
  }
} catch (err) {
  if (err.code && err.code === 'ENOENT') {
    console.error('Config file `tree.config.json` not found!');
    process.exit(1);
  }
}
