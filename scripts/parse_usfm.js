const fse = require('fs-extra');

const { Proskomma } = require('../dist/index.js');

// const contentPath = '../test/test_data/usfm/en_ust_oba.usfm'; // 57-TIT.usfm
// const contentPath = '../test/test_data/usfm/57-TIT.usfm';
const contentPath = '../test/test_data/usfm/57-TIT-custom.usfm';
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
  {includeScopes: ['chapter/','verse/']}
);

const docs = pk.documentList();

pk.gqlQuery(query)
  .then(async (output) => {
    // console.log(JSON.stringify(output, null, 2))
    const doc1 = output?.data?.documents?.[0];
    const bookId = doc1?.bookCode;
    const indices = doc1?.cvIndexes;
    console.log(bookId);
    const chapters = indices.map(item => item?.chapter);
    console.log(chapters);
    const content = await getChapters(bookId, chapters);
    fse.writeJsonSync('./book_content.json', content);
  })
  .catch(err => console.log(`ERROR: Could not run query: '${err}'`));

async function getChapter(bookId, chapter) {
  const chapterQuery = `{ documents
  {
    mainSequence {
      blocks(withScriptureCV: "${chapter}") {
        bs { payload }
        items { type subType payload }
      }
    }
  }
}`;
  // const output = `${bookId} - ${chapters}`;
  const output = await pk.gqlQuery(chapterQuery);
  // console.log(JSON.stringify(output, null, 2))
  return output;
}

async function getChapters(bookId, chapters) {
  if (bookId) {
    const contents = {};
    for (const c of chapters) {
      contents[c] = await getChapter(bookId, c);
    }
    console.log(JSON.stringify(contents, null, 2))
    return contents;
  }
  return null;
}