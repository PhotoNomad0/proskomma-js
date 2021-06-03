const fse = require('fs-extra');

const { Proskomma } = require('../dist/index.js');

// const contentPath = '../test/test_data/usfm/en_ust_oba.usfm'; // 57-TIT.usfm
const contentPath = '../test/test_data/usfm/57-TIT.usfm';
let content;

try {
  content = fse.readFileSync(contentPath);
} catch (err) {
  console.log(`ERROR: Could not read from USFM/USX file '${contentPath}'`);
  process.exit(1);
}

const contentType = contentPath.split('.').pop();

const query = `{ documents { bookCode: header(id:"bookCode") cvIndexes { chapter verseNumbers { number range } verseRanges { range numbers } } } }`;

const pk = new Proskomma();
//try {
let selectors = {
  lang: { name: 'eng' },
  abbr: { name: 'eng' },
};

pk.importDocument(
  selectors,
  contentType,
  content,
);

pk.gqlQuery(query)
  .then(output => {
    console.log(JSON.stringify(output, null, 2))
    const doc1 = output.data.documents[0];
    const bookId = doc1.bookCode;
    const indices = doc1.cvIndexes;
    console.log(bookId);
    chapters
  })
  .catch(err => console.log(`ERROR: Could not run query: '${err}'`));
