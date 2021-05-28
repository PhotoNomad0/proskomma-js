import { scopeEnum } from 'proskomma-utils';

const BitSet = require('bitset');
const deepCopy = require('deep-copy-all');

const {
  addTag,
  ByteArray,
  generateId,
  headerBytes,
  itemEnum,
  nComponentsForScope,
  parserConstants,
  pushSuccinctGraftBytes,
  pushSuccinctScopeBytes,
  pushSuccinctTokenBytes,
  removeTag,
  scopeEnumLabels,
  succinctGraftSeqId,
  tokenEnum,
  validateTags,
} = require('proskomma-utils');
const {
  parseUsfm,
  parseUsx,
  parseLexicon,
} = require('../parser/lexers');
const { Parser } = require('../parser');

const emptyCVIndexType = 0;
const shortCVIndexType = 2;
const longCVIndexType = 3;

// const maybePrint = str => console.log(str);
const maybePrint = str => str;

class Document {
  constructor(processor, docSetId, contentType, contentString, filterOptions, customTags, emptyBlocks, tags) {
    this.processor = processor;
    this.docSetId = docSetId;
    this.baseSequenceTypes = parserConstants.usfm.baseSequenceTypes;

    if (contentType) {
      this.id = generateId();
      this.filterOptions = filterOptions;
      this.customTags = customTags;
      this.emptyBlocks = emptyBlocks;
      this.tags = new Set(tags || []);
      validateTags(this.tags);
      this.headers = {};
      this.mainId = null;
      this.sequences = {};

      switch (contentType) {
      case 'usfm':
        this.processUsfm(contentString);
        break;
      case 'usx':
        this.processUsx(contentString);
        break;
      case 'lexicon':
        this.processLexicon(contentString);
        break;
      default:
        throw new Error(`Unknown document contentType '${contentType}'`);
      }
    }
  }

  addTag(tag) {
    addTag(this.tags, tag);
  }

  removeTag(tag) {
    removeTag(this.tags, tag);
  }

  makeParser() {
    return new Parser(
      this.filterOptions,
      this.customTags,
      this.emptyBlocks,
    );
  }

  processUsfm(usfmString) {
    const parser = this.makeParser();
    const t = Date.now();
    parseUsfm(usfmString, parser);
    const t2 = Date.now();
    maybePrint(`\nParse USFM in ${t2 - t} msec`);
    this.postParseScripture(parser);
    maybePrint(`Total USFM import time = ${Date.now() - t} msec (parse = ${((t2 - t) * 100) / (Date.now() - t)}%)`);
  }

  processUsx(usxString) {
    const parser = this.makeParser();
    const t = Date.now();
    parseUsx(usxString, parser);
    const t2 = Date.now();
    maybePrint(`\nParse USX in ${t2 - t} msec`);
    this.postParseScripture(parser);
    maybePrint(`Total USX import time = ${Date.now() - t} msec (parse = ${((t2 - t) * 100) / (Date.now() - t)}%)`);
  }

  postParseScripture(parser) {
    let t = Date.now();
    parser.tidy();
    maybePrint(`Tidy in ${Date.now() - t} msec`);
    t = Date.now();
    const fo = parser.filterOptions;
    // parser.filter();
    maybePrint(`Filter in ${Date.now() - t} msec`);
    t = Date.now();
    this.headers = parser.headers;
    this.succinctPass1(parser);
    maybePrint(`Succinct pass 1 in ${Date.now() - t} msec`);
    t = Date.now();
    this.succinctPass2(parser);
    maybePrint(`Succinct pass 2 in ${Date.now() - t} msec`);
    t = Date.now();
    this.succinctFilter(fo);
    this.buildChapterVerseIndex(this.sequences[this.mainId]);
    maybePrint(`CV indexes in ${Date.now() - t} msec`);
  }

  processLexicon(lexiconString) {
    const parser = this.makeParser();
    parseLexicon(lexiconString, parser);
    this.headers = parser.headers;
    this.succinctPass1(parser);
    this.succinctPass2(parser);
  }

  modifySequence(
    seqId,
    sequenceRewriteFunc,
    blockFilterFunc,
    itemFilterFunc,
    blockRewriteFunc,
    itemRewriteFunc,
  ) {
    const docSet = this.processor.docSets[this.docSetId];
    docSet.maybeBuildEnumIndexes();
    sequenceRewriteFunc = sequenceRewriteFunc || (s => s);
    const oldSequence = this.sequences[seqId];
    const newSequence = sequenceRewriteFunc({
      id: seqId,
      type: oldSequence.type,
      tags: oldSequence.tags,
      isBaseType: oldSequence.isBaseType,
      verseMapping: oldSequence.verseMapping,
    });

    this.pushModifiedBlocks(
      oldSequence,
      newSequence,
      blockFilterFunc,
      itemFilterFunc,
      blockRewriteFunc,
      itemRewriteFunc,
    );
    this.sequences[seqId] = newSequence;

    if (newSequence.type === 'main') {
      this.buildChapterVerseIndex(newSequence);
    }
    return newSequence;
  }

  pushModifiedBlocks(
    oldSequence,
    newSequence,
    blockFilterFunc,
    itemFilterFunc,
    blockRewriteFunc,
    itemRewriteFunc,
  ) {
    blockFilterFunc = blockFilterFunc || ((oldSequence, blockN, block) => !!block);
    itemFilterFunc = itemFilterFunc ||
      ((oldSequence, oldBlockN, block, itemN, itemType, itemSubType, pos) => !!block || pos);
    blockRewriteFunc = blockRewriteFunc || ((oldSequence, blockN, block) => block);
    itemRewriteFunc = itemRewriteFunc ||
      (
        (oldSequence, oldBlockN, oldBlock, newBlock, itemN, itemLength, itemType, itemSubType, pos) =>
          this.copyItem(oldBlock.c, newBlock.c, pos, itemLength)
      );
    newSequence.blocks = [];

    for (const [blockN, block] of oldSequence.blocks.entries()) {
      if (blockFilterFunc(oldSequence, blockN, block)) {
        const newBlock = blockRewriteFunc(oldSequence, blockN, deepCopy(block));
        newBlock.c.clear();
        this.modifyBlockItems(
          oldSequence,
          blockN,
          block,
          newBlock,
          itemFilterFunc,
          itemRewriteFunc,
        );
        newSequence.blocks.push(newBlock);
      }
    }
  }

  modifyBlockItems(
    oldSequence,
    oldBlockN,
    oldBlock,
    newBlock,
    itemFilterFunc,
    itemRewriteFunc,
  ) {
    let pos = 0;
    let itemN = -1;

    while (pos < oldBlock.c.length) {
      itemN++;
      const [itemLength, itemType, itemSubtype] = headerBytes(oldBlock.c, pos);

      if (itemFilterFunc(oldSequence, oldBlockN, oldBlock, itemN, itemType, itemSubtype, pos)) {
        itemRewriteFunc(oldSequence, oldBlockN, oldBlock, newBlock, itemN, itemLength, itemType, itemSubtype, pos);
      }
      pos += itemLength;
    }
  }

  copyItem(oldBA, newBA, oldOffset, itemLength) {
    for (let n = 0; n < itemLength; n++) {
      newBA.pushByte(oldBA.byte(oldOffset + n));
    }
  }

  succinctFilter(filterOptions) {
    if (!filterOptions || Object.keys(filterOptions).length === 0) {
      return;
    }

    const docSet = this.processor.docSets[this.docSetId];

    const filterItem = (oldSequence, oldBlockN, block, itemN, itemType, itemSubType, pos) => {
      if (itemType === itemEnum.token) {
        return true;
      } else if (itemType === itemEnum.startScope || itemType === itemEnum.endScope) {
        if (!filterOptions.includeScopes && !filterOptions.excludeScopes) {
          return true;
        } else {
          const scopeOb = docSet.unsuccinctifyScope(block.c, itemType, itemSubType, pos);
          return (
            (
              !filterOptions.includeScopes ||
              filterOptions.includeScopes.filter(op => scopeOb[2].startsWith(op)).length > 0
            )
            &&
            (
              !filterOptions.excludeScopes ||
              filterOptions.excludeScopes.filter(op => scopeOb[2].startsWith(op)).length === 0
            )
          );
        }
      } else { // graft
        if (!filterOptions.includeGrafts && !filterOptions.excludeGrafts) {
          return true;
        }

        const graftOb = docSet.unsuccinctifyGraft(block.c, itemSubType, pos);
        return (
          (
            !filterOptions.includeGrafts ||
            filterOptions.includeGrafts.filter(op => graftOb[1].startsWith(op)).length > 0
          )
          &&
          (
            !filterOptions.excludeGrafts ||
            filterOptions.excludeGrafts.filter(op => graftOb[1].startsWith(op)).length === 0
          )
        );
      }
    };

    Object.keys(this.sequences).forEach(
      seqId => {
        this.modifySequence(
          seqId,
          null,
          null,
          filterItem,
          null, //rewriteBlock,
          null,
        );
      },
    );
    Object.values(this.sequences).forEach(
      seq => docSet.updateBlockIndexesAfterFilter(seq),
    );
    this.gcSequences();
  }

  succinctPass1(parser) {
    const docSet = this.processor.docSets[this.docSetId];

    let t = Date.now();

    for (const seq of parser.allSequences()) {
      docSet.recordPreEnum('ids', seq.id);
      this.recordPreEnums(docSet, seq);
    }
    maybePrint(`   recordPreEnums in ${Date.now() - t} msec`);
    t = Date.now();

    if (docSet.enums.wordLike.length === 0) {
      docSet.sortPreEnums();
      maybePrint(`   sortPreEnums in ${Date.now() - t} msec`);
      t = Date.now();
    }
    docSet.buildEnums();
    maybePrint(`   buildEnums in ${Date.now() - t} msec`);
  }

  recordPreEnums(docSet, seq) {
    docSet.recordPreEnum('scopeBits', '0');

    for (const block of seq.blocks) {
      for (const item of [...block.items, block.bs, ...block.bg]) {
        if (item.subType === 'wordLike') {
          docSet.recordPreEnum('wordLike', item.payload);
        } else if (['lineSpace', 'eol', 'punctuation', 'softLineBreak', 'bareSlash', 'unknown'].includes(item.subType)) {
          docSet.recordPreEnum('notWordLike', item.payload);
        } else if (item.type === 'graft') {
          docSet.recordPreEnum('graftTypes', item.subType);
        } else if (item.subType === 'start') {
          const labelBits = item.payload.split('/');

          if (labelBits.length !== nComponentsForScope(labelBits[0])) {
            throw new Error(`Scope ${item.payload} has unexpected number of components`);
          }

          for (const labelBit of labelBits.slice(1)) {
            docSet.recordPreEnum('scopeBits', labelBit);
          }
        }
      }
    }
  }

  rerecordPreEnums(docSet, seq) {
    docSet.recordPreEnum('scopeBits', '0');
    docSet.recordPreEnum('ids', seq.id);

    for (const block of seq.blocks) {
      for (const blockKey of ['bs', 'bg', 'c', 'is', 'os']) {
        this.rerecordBlockPreEnums(docSet, block[blockKey]);
      }
    }
  }

  rerecordBlockPreEnums(docSet, ba) {
    for (const item of docSet.unsuccinctifyItems(ba, {}, 0)) {
      if (item[0] === 'token') {
        if (item[1] === 'wordLike') {
          docSet.recordPreEnum('wordLike', item[2]);
        } else {
          docSet.recordPreEnum('notWordLike', item[2]);
        }
      } else if (item[0] === 'graft') {
        docSet.recordPreEnum('graftTypes', item[1]);
      } else if (item[0] === 'scope' && item[1] === 'start') {
        const labelBits = item[2].split('/');

        if (labelBits.length !== nComponentsForScope(labelBits[0])) {
          throw new Error(`Scope ${item[2]} has unexpected number of components`);
        }

        for (const labelBit of labelBits.slice(1)) {
          docSet.recordPreEnum('scopeBits', labelBit);
        }
      }
    }
  }

  succinctPass2(parser) {
    const docSet = this.processor.docSets[this.docSetId];
    this.mainId = parser.sequences.main.id;

    for (const seq of parser.allSequences()) {
      this.sequences[seq.id] = {
        id: seq.id,
        type: seq.type,
        tags: new Set(seq.tags),
        isBaseType: (seq.type in parser.baseSequenceTypes),
        blocks: seq.succinctifyBlocks(docSet),
      };
    }
    this.sequences[this.mainId].verseMapping = {};
  }

  buildChapterVerseIndex(mainSequence) {
    const docSet = this.processor.docSets[this.docSetId];
    docSet.buildPreEnums();
    docSet.buildEnumIndexes();
    const chapterVerseIndexes = {};
    const chapterIndexes = {};
    let chapterN = '0';
    let verseN = '0';
    let verses = '1';
    let nextTokenN = 0;

    mainSequence.chapterVerses = {};
    mainSequence.tokensPresent = new BitSet(
      new Array(docSet.enums.wordLike.length)
        .fill(0)
        .map(b => b.toString())
        .join(''),
    );

    for (const [blockN, block] of mainSequence.blocks.entries()) {
      let pos = 0;
      let succinct = block.c;
      let itemN = -1;

      while (pos < succinct.length) {
        itemN++;
        const [itemLength, itemType, itemSubtype] = headerBytes(succinct, pos);

        if (itemType === itemEnum['startScope']) {
          let scopeLabel = docSet.succinctScopeLabel(succinct, itemSubtype, pos);

          if (scopeLabel.startsWith('chapter/')) {
            chapterN = scopeLabel.split('/')[1];
            chapterVerseIndexes[chapterN] = {};
            chapterIndexes[chapterN] = {
              startBlock: blockN,
              startItem: itemN,
              nextToken: nextTokenN,
            };
          } else if (scopeLabel.startsWith('verse/')) {
            verseN = scopeLabel.split('/')[1];

            if (verseN === '1' && !('0' in chapterVerseIndexes[chapterN])) {
              if (chapterIndexes[chapterN].nextToken < nextTokenN) {
                chapterVerseIndexes[chapterN]['0'] = [{
                  startBlock: chapterIndexes[chapterN].startBlock,
                  startItem: chapterIndexes[chapterN].startItem,
                  endBlock: blockN,
                  endItem: Math.max(itemN - 1, 0),
                  nextToken: chapterIndexes[chapterN].nextToken,
                  verses: '0',
                }];
              }
            }

            if (!(verseN in chapterVerseIndexes[chapterN])) {
              chapterVerseIndexes[chapterN][verseN] = [];
            }
            chapterVerseIndexes[chapterN][verseN].push({
              startBlock: blockN,
              startItem: itemN,
              nextToken: nextTokenN,
            });
          } else if (scopeLabel.startsWith('verses/')) {
            verses = scopeLabel.split('/')[1];
          }
        } else if (itemType === itemEnum['endScope']) {
          let scopeLabel = docSet.succinctScopeLabel(succinct, itemSubtype, pos);

          if (scopeLabel.startsWith('chapter/')) {
            chapterN = scopeLabel.split('/')[1];
            let chapterRecord = chapterIndexes[chapterN];

            if (chapterRecord) { // Check start chapter has not been deleted
              chapterRecord.endBlock = blockN;
              chapterRecord.endItem = itemN;
            }
          } else if (scopeLabel.startsWith('verse/')) {
            verseN = scopeLabel.split('/')[1];
            let versesRecord = chapterVerseIndexes[chapterN][verseN];

            if (versesRecord) { // Check start verse has not been deleted
              const verseRecord = chapterVerseIndexes[chapterN][verseN][chapterVerseIndexes[chapterN][verseN].length - 1];
              verseRecord.endBlock = blockN;
              verseRecord.endItem = itemN;
              verseRecord.verses = verses;
            }
          }
        } else if (itemType === itemEnum['token'] && itemSubtype === tokenEnum['wordLike']) {
          mainSequence.tokensPresent
            .set(
              succinct.nByte(pos + 2),
              1,
            );
          nextTokenN++;
        }
        pos += itemLength;
      }
    }

    for (const [chapterN, chapterVerses] of Object.entries(chapterVerseIndexes)) {
      const ba = new ByteArray();
      mainSequence.chapterVerses[chapterN] = ba;
      const sortedVerses = Object.keys(chapterVerses)
        .map(n => parseInt(n))
        .sort((a, b) => a - b);

      if (sortedVerses.length === 0) {
        continue;
      }

      const maxVerse = sortedVerses[sortedVerses.length - 1];
      const verseSlots = Array.from(Array(maxVerse + 1).keys());
      let pos = 0;

      for (const verseSlot of verseSlots) {
        const verseKey = `${verseSlot}`;

        if (verseKey in chapterVerses) {
          const verseElements = chapterVerses[verseKey];
          const nVerseElements = verseElements.length;

          for (const [verseElementN, verseElement] of verseElements.entries()) {
            const versesEnumIndex = docSet.enumForCategoryValue('scopeBits', verseElement.verses);
            const recordType = verseElement.startBlock === verseElement.endBlock ? shortCVIndexType : longCVIndexType;
            ba.pushByte(0);

            if (recordType === shortCVIndexType) {
              ba.pushNBytes([
                verseElement.startBlock,
                verseElement.startItem,
                verseElement.endItem,
                verseElement.nextToken,
                versesEnumIndex,
              ]);
            } else {
              ba.pushNBytes([
                verseElement.startBlock,
                verseElement.endBlock,
                verseElement.startItem,
                verseElement.endItem,
                verseElement.nextToken,
                versesEnumIndex,
              ]);
            }
            ba.setByte(pos, this.makeVerseLengthByte(recordType, verseElementN === (nVerseElements - 1), ba.length - pos));
            pos = ba.length;
          }
        } else {
          ba.pushByte(this.makeVerseLengthByte(emptyCVIndexType, true, 1));
          pos++;
        }
      }
      ba.trim();
    }
    mainSequence.chapters = {};

    for (const [chapterN, chapterElement] of Object.entries(chapterIndexes)) {
      if (!('startBlock' in chapterElement) || !('endBlock' in chapterElement)) {
        continue;
      }

      const ba = new ByteArray();
      mainSequence.chapters[chapterN] = ba;
      const recordType = chapterElement.startBlock === chapterElement.endBlock ? shortCVIndexType : longCVIndexType;
      ba.pushByte(0);

      if (recordType === shortCVIndexType) {
        ba.pushNBytes([chapterElement.startBlock, chapterElement.startItem, chapterElement.endItem, chapterElement.nextToken]);
      } else {
        ba.pushNBytes([chapterElement.startBlock, chapterElement.endBlock, chapterElement.startItem, chapterElement.endItem, chapterElement.nextToken]);
      }
      ba.setByte(0, this.makeVerseLengthByte(recordType, true, ba.length));
      ba.trim();
    }
  }

  chapterVerseIndexes() {
    const ret = {};

    for (const chapN of Object.keys(this.sequences[this.mainId].chapterVerses)) {
      ret[chapN] = this.chapterVerseIndex(chapN);
    }
    return ret;
  }

  chapterIndexes() {
    const ret = {};

    for (const chapN of Object.keys(this.sequences[this.mainId].chapters)) {
      ret[chapN] = this.chapterIndex(chapN);
    }
    return ret;
  }

  chapterVerseIndex(chapN) {
    const docSet = this.processor.docSets[this.docSetId];
    docSet.buildEnumIndexes();
    const ret = [];
    const succinct = this.sequences[this.mainId].chapterVerses[chapN];

    if (succinct) {
      let pos = 0;
      let currentVerseRecord = [];

      while (pos < succinct.length) {
        const [recordType, isLast, recordLength] = this.verseLengthByte(succinct, pos);

        if (recordType === shortCVIndexType) {
          const nBytes = succinct.nBytes(pos + 1, 5);

          currentVerseRecord.push({
            startBlock: nBytes[0],
            endBlock: nBytes[0],
            startItem: nBytes[1],
            endItem: nBytes[2],
            nextToken: nBytes[3],
            verses: docSet.enums.scopeBits.countedString(docSet.enumIndexes.scopeBits[nBytes[4]]),
          });
        } else if (recordType === longCVIndexType) {
          const nBytes = succinct.nBytes(pos + 1, 6);

          currentVerseRecord.push({
            startBlock: nBytes[0],
            endBlock: nBytes[1],
            startItem: nBytes[2],
            endItem: nBytes[3],
            nextToken: nBytes[4],
            verses: docSet.enums.scopeBits.countedString(docSet.enumIndexes.scopeBits[nBytes[5]]),
          });
        }

        if (isLast) {
          ret.push(currentVerseRecord);
          currentVerseRecord = [];
        }
        pos += recordLength;
      }
    }
    return ret;
  }

  chapterIndex(chapN) {
    const succinct = this.sequences[this.mainId].chapters[chapN];

    if (succinct) {
      const recordType = this.verseLengthByte(succinct, 0)[0];

      if (recordType === shortCVIndexType) {
        const nBytes = succinct.nBytes(1, 4);

        return {
          startBlock: nBytes[0],
          endBlock: nBytes[0],
          startItem: nBytes[1],
          endItem: nBytes[2],
          nextToken: nBytes[3],
        };
      } else if (recordType === longCVIndexType) {
        const nBytes = succinct.nBytes(1, 5);

        return {
          startBlock: nBytes[0],
          endBlock: nBytes[1],
          startItem: nBytes[2],
          endItem: nBytes[3],
          nextToken: nBytes[4],
        };
      }
    }
  }

  makeVerseLengthByte(recordType, isLast, length) {
    return length + (isLast ? 32 : 0) + (recordType * 64);
  }

  verseLengthByte(succinct, pos) {
    const sByte = succinct.byte(pos);
    return [
      sByte >> 6,
      (sByte >> 5) % 2 === 1,
      sByte % 32,
    ];
  }

  rewriteSequenceBlocks(sequenceId, oldToNew) {
    const sequence = this.sequences[sequenceId];

    for (const block of sequence.blocks) {
      this.rewriteSequenceBlock(block, oldToNew);
    }
  }

  rewriteSequenceBlock(block, oldToNew) {
    for (const blockKey of ['bs', 'bg', 'c', 'is', 'os']) {
      const oldBa = block[blockKey];
      const newBa = new ByteArray(oldBa.length);
      let pos = 0;

      while (pos < oldBa.length) {
        const [itemLength, itemType, itemSubtype] = headerBytes(oldBa, pos);

        if (itemType === itemEnum['token']) {
          if (itemSubtype === tokenEnum.wordLike) {
            pushSuccinctTokenBytes(newBa, itemSubtype, oldToNew.wordLike[oldBa.nByte(pos + 2)]);
          } else {
            pushSuccinctTokenBytes(newBa, itemSubtype, oldToNew.notWordLike[oldBa.nByte(pos + 2)]);
          }
        } else if (itemType === itemEnum['graft']) {
          pushSuccinctGraftBytes(newBa, oldToNew.graftTypes[itemSubtype], oldToNew.ids[oldBa.nByte(pos + 2)]);
        } else {
          let nScopeBitBytes = nComponentsForScope(scopeEnumLabels[itemSubtype]);
          const scopeBitBytes = [];
          let offset = 2;

          while (nScopeBitBytes > 1) {
            const scopeBitByte = oldToNew.scopeBits[oldBa.nByte(pos + offset)];
            scopeBitBytes.push(scopeBitByte);
            offset += oldBa.nByteLength(scopeBitByte);
            nScopeBitBytes--;
          }
          pushSuccinctScopeBytes(newBa, itemType, itemSubtype, scopeBitBytes);
        }
        pos += itemLength;
      }
      newBa.trim();
      block[blockKey] = newBa;
    }
  }

  serializeSuccinct() {
    const ret = { sequences: {} };
    ret.headers = this.headers;
    ret.mainId = this.mainId;
    ret.tags = Array.from(this.tags);

    for (const [seqId, seqOb] of Object.entries(this.sequences)) {
      ret.sequences[seqId] = this.serializeSuccinctSequence(seqOb);
    }
    return ret;
  }

  serializeSuccinctSequence(seqOb) {
    const ret = {
      type: seqOb.type,
      blocks: seqOb.blocks.map(b => this.serializeSuccinctBlock(b)),
      tags: Array.from(seqOb.tags),
    };

    if (seqOb.type === 'main') {
      ret.chapters = {};

      for (const [chK, chV] of Object.entries(seqOb.chapters)) {
        ret.chapters[chK] = chV.base64();
      }
      ret.chapterVerses = {};

      for (const [chvK, chvV] of Object.entries(seqOb.chapterVerses)) {
        ret.chapterVerses[chvK] = chvV.base64();
      }

      if ('tokensPresent' in seqOb) {
        ret.tokensPresent = '0x' + seqOb.tokensPresent.toString(16);
      }
    }
    return ret;
  }

  serializeSuccinctBlock(blockOb) {
    return {
      bs: blockOb.bs.base64(),
      bg: blockOb.bg.base64(),
      c: blockOb.c.base64(),
      is: blockOb.is.base64(),
      os: blockOb.os.base64(),
      nt: blockOb.nt.base64(),
    };
  }

  gcSequences() {
    const usedSequences = new Set();
    const docSet = this.processor.docSets[this.docSetId];

    const followGrafts = (document, sequence, used) => {
      used.add(sequence.id);

      for (const block of sequence.blocks) {
        for (const blockGraft of docSet.unsuccinctifyGrafts(block.bg)) {
          if (!used.has(blockGraft[2])) {
            followGrafts(document, document.sequences[blockGraft[2]], used);
          }
        }

        for (const inlineGraft of docSet.unsuccinctifyItems(block.c, { grafts: true }, 0)) {
          if (!used.has(inlineGraft[2])) {
            followGrafts(document, document.sequences[inlineGraft[2]], used);
          }
        }
      }
    };

    followGrafts(this, this.sequences[this.mainId], usedSequences);
    let changed = false;

    for (const sequenceId of Object.keys(this.sequences)) {
      if (!usedSequences.has(sequenceId)) {
        delete this.sequences[sequenceId];
        changed = true;
      }
    }

    return changed;
  }

  newSequence(seqType) {
    const seqId = generateId();

    this.sequences[seqId] = {
      id: seqId,
      type: seqType,
      tags: new Set(),
      isBaseType: (seqType in this.baseSequenceTypes),
      blocks: [],
    };

    return seqId;
  }

  deleteSequence(seqId) {
    if (!(seqId in this.sequences)) {
      return false;
    }

    if (this.sequences[seqId].type === 'main') {
      throw new Error('Cannot delete main sequence');
    }

    if (this.sequences[seqId].type in this.baseSequenceTypes) {
      this.gcSequenceReferences('block', seqId);
    } else {
      this.gcSequenceReferences('inline', seqId);
    }
    delete this.sequences[seqId];
    this.buildChapterVerseIndex(this.sequences[this.mainId]);
    this.gcSequences();
    return true;
  }

  gcSequenceReferences(seqContext, seqId) {
    const docSet = this.processor.docSets[this.docSetId];

    for (const sequence of Object.values(this.sequences)) {
      for (const block of sequence.blocks) {
        const succinct = seqContext === 'block' ? block.bg : block.c;
        let pos = 0;

        while (pos < succinct.length) {
          const [itemLength, itemType] = headerBytes(succinct, pos);

          if (itemType !== itemEnum.graft) {
            pos += itemLength;
          } else {
            const graftSeqId = succinctGraftSeqId(docSet.enums, docSet.enumIndexes, succinct, pos);

            if (graftSeqId === seqId) {
              succinct.deleteItem(pos);
            } else {
              pos += itemLength;
            }
          }
        }
      }
    }
  }

  deleteBlock(seqId, blockN) {
    if (!(seqId in this.sequences)) {
      return false;
    }

    const sequence = this.sequences[seqId];

    if (blockN < 0 || blockN >= sequence.blocks.length) {
      return false;
    }
    sequence.blocks.splice(blockN, 1);
    this.buildChapterVerseIndex(this.sequences[this.mainId]);
    return true;
  }

  newBlock(seqId, blockN, blockScope) {
    if (!(seqId in this.sequences)) {
      return false;
    }

    const sequence = this.sequences[seqId];

    if (blockN < 0 || blockN > sequence.blocks.length) {
      return false;
    }

    const docSet = this.processor.docSets[this.docSetId];
    docSet.maybeBuildPreEnums();

    const newBlock = {
      bs: new ByteArray(0),
      bg: new ByteArray(0),
      c: new ByteArray(0),
      os: new ByteArray(0),
      is: new ByteArray(0),
    };
    const scopeBits = blockScope.split('/');
    const scopeTypeByte = scopeEnum[scopeBits[0]];
    const expectedNScopeBits = nComponentsForScope(scopeBits[0]);

    if (scopeBits.length !== expectedNScopeBits) {
      throw new Error(`Scope ${blockScope} has ${scopeBits.length} component(s) (expected ${expectedNScopeBits}`);
    }

    const scopeBitBytes = scopeBits.slice(1).map(b => docSet.enumForCategoryValue('scopeBits', b, true));
    pushSuccinctScopeBytes(newBlock.bs, itemEnum[`startScope`], scopeTypeByte, scopeBitBytes);
    sequence.blocks.splice(blockN, 0, newBlock);
    this.buildChapterVerseIndex(this.sequences[this.mainId]);
    return true;
  }
}

module.exports = { Document };
