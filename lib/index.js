const fs = require("fs");
const path = require("path");
const lunr = require("lunr");
const yargs = require("yargs");
const pipe = require("lodash/fp/flow");
const debug = require("./debug");
const { createSearchIndex } = require("./create-index");

const argv = yargs
  .scriptName("search-notes")
  .command(
    "$0 [query]",
    "Search for notes using structured data and full text index, with fuzzy matching.",
    yargs => {
      yargs
        .positional("query", {
          type: "string",
          describe: "text to search for",
          default: "",
        })
        .example("$0 highlands", "basic text search")
        .example("$0 name:wallace", "search yaml frontmatter")
        .example('$0 "tags:royalty britain"', "multiple terms")
        .example('$0 "brit*"', "prefix search")
        .example('$0 "scatlond~1"', "fuzzy search")
        .example('$0 "scatlonz~2"', "fuzzier search")
        .example('$0 "tags:stuart -france"', "negate term")
        .example('$0 "tags:stuart +france"', "boolean AND")
        .example('$0 "britain^2 france^1"', "boost term relevance")
        .example("$0 -w", "re-index folder and save cache to disk")
        .example("$0 -c index.json query", "specify index cache file");
    },
  )
  .option("directory", {
    default: "",
    type: "string",
    describe: "directory to search in",
    alias: "d",
  })
  .option("cache", {
    default: "search.json",
    type: "string",
    describe: "cached search index to use (ignored if file doesn't exist)",
    alias: "c",
  })
  .option("write-cache", {
    default: false,
    type: "boolean",
    describe: "create or update search index cache file",
    alias: "w",
  })
  .option("explain", {
    default: true,
    type: "boolean",
    describe: "show relevance score and other details for results",
  })
  .wrap(yargs.terminalWidth())
  .version()
  .help().argv;

function searchNotes({ query, directory, cache, writeCache, explain }) {
  let schema;
  const time = process.hrtime();
  if (cache && !writeCache) {
    try {
      // The way the default flags are set means we always load the cache file if it exists;
      // if we can't find it we create an in-memory index.
      // Passing -w will create or update the index on disk.
      const schemaFile = fs.readFileSync(
        path.resolve(directory, cache),
        "utf8",
      );
      schema = JSON.parse(schemaFile);
    } catch (err) {
      schema = createSearchIndex({ directory }); // Index on the fly and don't save it to disk
    }
  } else if (cache && writeCache) {
    // Re-index the directory and save the result to the cache location
    debug("Creating search index cache...");
    schema = createSearchIndex({ directory, write: true, filename: cache });
    const diff = process.hrtime(time);
    console.log(`Updated index file in ${(diff[0] * 1e9 + diff[1])/1e9} seconds`);
  }
  const diff = process.hrtime(time);
  if (explain) {
    console.log(`Search took ${(diff[0] * 1e9 + diff[1])/1e9} seconds`);
  }
  const idx = lunr.Index.load(schema);
  const results = idx.search(query);
  debug(results);
  return results;
}

/*
Search results shape:

[
  {
    ref: 'prince-charlie.md',
    score: 0.264,
  },
]
*/

function displayResults(searchResults) {
  if (argv.explain) {
    console.table(
      searchResults.map(r => ({
        File: r.ref,
        Score: r.score.toFixed(3),
        Hits: 
          Object.entries(r.matchData.metadata).map(([key, val]) => `"${key}" (${Object.keys(val).join(', ')})`).join(', ')
        
      })),
    );
  } else {
    searchResults.map(r => console.log(r.ref));
  }
}

debug(argv);

pipe(searchNotes, displayResults)(argv);
