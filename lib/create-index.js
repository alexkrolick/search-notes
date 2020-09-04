const fs = require("fs");
const path = require("path");
const Remarkable = require("remarkable").Remarkable;
const RemarkableMeta = require("remarkable-meta");
const lunr = require("lunr");
const debug = require("./debug");
const flatMap = require("lodash/fp/flatMap");
const flatten = require("lodash/fp/flatten");

// TODO: find a good way to compose processing pipeline for perf & maintainability
// File processing pipeline context object:
const pipeline = {};
pipeline.metadataFields = new Set(["file", "body"]);
pipeline.parsedFiles = [];
pipeline.directory = "./";
pipeline.createCache = false;
pipeline.cacheLocation = null;

// Load all the files in target directory
// TODO: use yargs for CLI input; export a normal module, too
function createSearchIndex({ directory, filename, write = false }) {
  pipeline.directory = directory;
  pipeline.createCache = write;
  pipeline.cacheLocation = filename;
  const files = fs.readdirSync(path.resolve(directory));

  // TODO: some of this can happen async or in serial batches
  for (const file of files) {
    const output = processFile({ filename: file, directory });
    if (output) {
      debug(output);
      pipeline.parsedFiles.push(output);
    }
  }

  const index = indexDocuments();

  debug("Finished indexing");

  return index;
}

// Process each file with remarkable markdown parser

/**
 * @param {string} filename
 * @return {void}
 */
function processFile({ directory, filename }) {
  // Ignore non-markdown files
  if (!filename.endsWith(".md")) return;
  const f = path.resolve(directory, filename);
  debug(f);
  const raw = fs.readFileSync(f, "utf8");

  // Parse content
  const md = new Remarkable();
  md.use(RemarkableMeta);
  const html = md.render(raw);

  // Extract YML frontmatter as structured data
  const meta = md.meta;

  // Add hashtags to metadata using regex search in markdown body
  // TODO: this might also catch #id in-page links, is that good?
  // Dedupe and merge with tags field from frontmatter, if present
  const tags = new Set(
    (raw.match(/#\w+\b/gi) || []).map((match) => {
      // take off the "#" symbol
      return match.slice(1);
    }),
  );
  // Merge yml frontmatter "tags" field with #hashtag list
  if (typeof meta.tags === "string") {
    meta.tags.split(",").forEach((tag) => tags.add(tag));
  } else if (Array.isArray(meta.tags)) {
    meta.tags.forEach((tag) => tags.add(tag));
  }
  meta.tags = [...tags]; // convert set to array

  const docNodes = md.parse(raw, {});

  // Add outgoing links to metadata
  const isLinkNode = (n) => n.type === "link_open";
  const getLinks = (nodes) =>
    nodes.reduce((result, node) => {
      if (isLinkNode(node)) {
        result.push(node.href);
      } else if (node.children) {
        const childNodes = getLinks(node.children);
        if (childNodes) {
          result = result.concat(childNodes);
        }
      }
      return result;
    }, []);
  meta.linksTo = getLinks(docNodes);

  // TODO: Add title/name/document to metadata using first h1 tag, yml key, or filename?

  // SIDE-EFFECT: Update pipeline's field index
  const fields = Object.keys(meta);
  for (field of fields) {
    pipeline.metadataFields.add(field);
  }

  return { filename, html, fields, raw, frontmatter: meta };
}

function indexDocuments() {
  // Transform data to support query pattern we want
  const documents = pipeline.parsedFiles.map((f) => ({
    ...f.frontmatter,
    file: f.filename,
    body: f.raw,
    id: f.filename,
  }));

  // Create index
  // TODO: maybe use elasticlunr instead of raw lunr
  //       elasticlunr allows incremental index updates and more elasticsearch-like userspace APIs
  const index = lunr(function () {
    // Create schema:
    this.ref("id");
    for (const field of pipeline.metadataFields) {
      this.field(field);
    }

    documents.forEach(function (doc) {
      this.add(doc);
    }, this);
  });

  // TODO: Optimize index size https://github.com/olivernn/lunr.js/issues/316

  const cacheFileContents = JSON.stringify({ index, documents });

  // Save index to disk, if write option is enabled
  if (pipeline.createCache && pipeline.cacheLocation) {
    const f = path.resolve(pipeline.directory, pipeline.cacheLocation);
    debug(f);
    fs.writeFileSync(f, cacheFileContents);
  }

  // serialize and de-serialize objects to recast lunr objects
  const normalObject = JSON.parse(cacheFileContents);
  return normalObject;
}

module.exports = {
  createSearchIndex,
};
