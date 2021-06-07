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
  // {includeScopes: ['chapter/','verse/']}
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
  // query chapter by block
//   const chapterQuery = `{ documents
//   {
//     mainSequence {
//       blocks(withScriptureCV: "${chapter}") {
//         bs { payload }
//         items { type subType payload }
//       }
//     }
//   }
// }`;
  // query chapter, return everything (items)
  const chapterQuery = `{ documents
  {
    cv (chapter:"${chapter}") {
      items { type subType payload }
    }
  }
}`;
  // const output = `${bookId} - ${chapters}`;
  const chapterData = await pk.gqlQuery(chapterQuery);
  const results = makeNestedView(chapterData);
  // console.log(JSON.stringify(output, null, 2))
  return results;
}

const verseMark = /^verse\/(\w+)$/;
const attributeMark = /^attribute\/(.+)$/;

function makeNestedView(content) {
  const results = {};
  const cv = content?.data?.documents?.[0]?.cv?.[0]?.items;
  let verseId = 'front';
  let idx = 0;
  let len = cv.length;
  let matched;
  let verseContent = [];
  let stack = [];
  let currentNode;

  while (idx < len) { // iterate all
    const obj = cv[idx++];

    if (!currentNode) {
      currentNode = { children: [] };
      verseContent.push(currentNode);
      stack.push(currentNode);
    }

    const subType = obj.subType;

    // eslint-disable-next-line no-cond-assign
    if (subType === 'start') {
      matched = obj?.payload?.match(verseMark);

      if (matched) { // is verse start marker
        currentNode.children.push(obj);
        const foundVerse = matched[1];

        if (foundVerse) {
          results[verseId] = verseContent;
          verseId = foundVerse;
          obj.children = [];
          currentNode = obj;
          verseContent = [currentNode];
          stack = [currentNode];
        }
      } else {
        matched = obj?.payload?.match(attributeMark);

        if (matched && currentNode?.payload) {
          const match = `attribute/${currentNode.payload}`;
          const pos = obj?.payload?.indexOf(match);
          const attribute = (pos === 0) ? obj?.payload.substr(match.length + 1) : obj?.payload;

          if (!currentNode.attributes) {
            currentNode.attributes = [];
          }

          let currentAttributes = currentNode.attributes;
          let merged = false;

          if (currentAttributes.length) {
            const lastAttrIndex = currentAttributes.length - 1;
            const lastAttr = currentAttributes[lastAttrIndex];
            const lastAttrParts = lastAttr.split('/');
            const attrParts = attribute.split('/');

            if (lastAttrParts[0] === attrParts[0]) {
              if (lastAttrParts[1] === '0') {
                const newData = `${lastAttr},${attrParts[2]}`;
                currentAttributes[lastAttrIndex] = newData;
                merged = true;
              }
            }
          }

          if (!merged) {
            currentNode.attributes.push(attribute);
          }
        }
      }

      if (!matched) { // not verse start
        currentNode.children.push(obj);
        obj.children = [];
        stack.push(obj);
        currentNode = obj;
      }
    } else if (subType === 'end') {
      const isAttr = obj?.payload?.match(attributeMark);

      if (!isAttr) {
        let matched = false;

        for (let i = stack.length - 1; i >= 0; i--) {
          const ancestor = stack[i];

          if ((ancestor.subType === 'start') && (ancestor.payload === obj.payload)) {
            stack = stack.slice(0, i);

            currentNode = stack[i - 1];
            matched = true;
            break;
          }
        }

        if (!matched) { // no match, so start at top
          console.log(`ignored:`, obj);
        }
      }
    } else { // flat item
      currentNode.children.push(obj);
    }
  }
  results[verseId] = verseContent;
  return results;
}

async function getChapters(bookId, chapters) {
  if (bookId) {
    const contents = {};

    for (const c of chapters) {
      // eslint-disable-next-line no-await-in-loop
      contents[c] = await getChapter(bookId, c);
    }
    // console.log(JSON.stringify(contents, null, 2))
    return contents;
  }
  return null;
}