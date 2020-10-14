const test = require('tape');

const {pkWithDoc} = require('../lib/load');

const testGroup = "Graft Sidebars";

const pkWithUSX = pkWithDoc("../test_data/usx/sidebars.usx", "fra", "hello")[0];
const pkWithUSFM = pkWithDoc("../test_data/usfm/sidebars.usfm", "fra", "hello")[0];

const doTest = async (t, pk) => {
    t.plan(12);
    const query = `{ documents { sequences { id blocks { scopeLabels bg { type, sequenceId } } } mainSequence { id } } }`;
    const result = await pk.gqlQuery(query);
    t.ok("data" in result);
    const sequences = {};
    for (const seq of result.data.documents[0].sequences) {
        sequences[seq.id] = seq;
    }
    const mainSequence = sequences[result.data.documents[0].mainSequence.id];
    t.equal(mainSequence.blocks.length, 2);
    t.equal(mainSequence.blocks[0].bg.length, 4);
    t.equal(mainSequence.blocks[0].bg[0].type, "title");
    t.equal(mainSequence.blocks[0].bg[1].type, "introduction");
    t.equal(mainSequence.blocks[0].bg[2].type, "sidebar");
    t.equal(mainSequence.blocks[0].bg[3].type, "heading");
    t.equal(mainSequence.blocks[1].bg.length, 1);
    t.equal(mainSequence.blocks[1].bg[0].type, "sidebar");
    const sb1Sequence = sequences[mainSequence.blocks[0].bg[2].sequenceId];
    t.equal(sb1Sequence.blocks.length, 1);
    t.equal(sb1Sequence.blocks[0].bg.length, 2);
    t.ok(sb1Sequence.blocks[0].scopeLabels.includes("esbCat/Theme"));
    console.log(JSON.stringify(sb1Sequence, null, 2));
}

test(
    `USX (${testGroup})`,
    async function (t) {
        try {
            await doTest(t, pkWithUSX);
        } catch (err) {
            console.log(err)
        }
    }
);

test(
    `USFM (${testGroup})`,
    async function (t) {
        try {
            await doTest(t, pkWithUSFM);
        } catch (err) {
            console.log(err)
        }
    }
);