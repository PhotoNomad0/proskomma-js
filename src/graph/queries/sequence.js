import { enumStringIndex } from 'proskomma-utils';

const {
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
} = require('graphql');

const blockType = require('./block');
const itemGroupType = require('./itemGroup');
const inputAttSpecType = require('./input_att_spec');

const options = {
  tokens: false,
  scopes: true,
  grafts: false,
  requiredScopes: [],
};

const blockHasAtts = (docSet, block, attSpecsArray, attValuesArray, requireAll) => {
  let matched = new Set([]);

  for (const item of docSet.unsuccinctifyPrunedItems(block, options, false)) {
    const [att, attType, element, key, count, value] = item[1].split('/');

    for (const [n, attSpecs] of attSpecsArray.entries()) {
      for (const attSpec of attSpecs) {
        if (
          attType === attSpec.attType &&
          element === attSpec.tagName &&
          key === attSpec.attKey &&
          parseInt(count) === attSpec.valueN &&
          attValuesArray[n].includes(value)
        ) {
          if (!requireAll) {
            return true;
          }
          matched.add(n);
          break;
        }
      }

      if (matched.size === attSpecsArray.length) {
        return true;
      }
    }
  }
  return false;
};

const sequenceType = new GraphQLObjectType({
  name: 'Sequence',
  fields: () => ({
    id: { type: GraphQLNonNull(GraphQLString) },
    type: { type: GraphQLNonNull(GraphQLString) },
    nBlocks: {
      type: GraphQLNonNull(GraphQLInt),
      resolve: root => root.blocks.length,
    },
    blocks: {
      type: GraphQLNonNull(GraphQLList(GraphQLNonNull(blockType))),
      args: {
        withScopes: { type: GraphQLList(GraphQLNonNull(GraphQLString)) },
        positions: { type: GraphQLList(GraphQLNonNull(GraphQLInt)) },
        withBlockScope: { type: GraphQLString },
        withScriptureCV: { type: GraphQLString },
        attSpecs: { type: GraphQLList(GraphQLNonNull(GraphQLList(GraphQLNonNull(inputAttSpecType)))) },
        attValues: { type: GraphQLList(GraphQLNonNull(GraphQLList(GraphQLNonNull(GraphQLString)))) },
        allAtts: { type: GraphQLBoolean },
        withChars: { type: GraphQLList(GraphQLNonNull(GraphQLString)) },
      },
      resolve: (root, args, context) => {
        context.docSet.maybeBuildEnumIndexes();

        if (args.withScopes && args.withScriptureCV) {
          throw new Error('Cannot specify both withScopes and withScriptureCV');
        }

        if (args.attSpecs && !args.attValues) {
          throw new Error('Cannot specify attSpecs without attValues');
        }

        if (!args.attSpecs && args.attValues) {
          throw new Error('Cannot specify attValues without attSpecs');
        }

        if (args.attSpecs && args.attValues && (args.attSpecs.length !== args.attValues.length)) {
          throw new Error('attSpecs and attValues must be same length');
        }

        let ret = root.blocks;

        if (args.positions) {
          ret = Array.from(ret.entries()).filter(b => args.positions.includes(b[0])).map(b => b[1]);
        }

        if (args.withScopes) {
          ret = ret.filter(b => context.docSet.allScopesInBlock(b, args.withScopes));
        }

        if (args.withScriptureCV) {
          ret = context.docSet.blocksWithScriptureCV(ret, args.withScriptureCV);
        }

        if (args.attSpecs) {
          ret = ret.filter(b => blockHasAtts(context.docSet, b, args.attSpecs, args.attValues, args.allAtts || false));
        }

        if (args.withBlockScope) {
          ret = ret.filter(b => context.docSet.blockHasBlockScope(b, args.withBlockScope));
        }

        if (args.withChars) {
          const charsIndexes = args.withChars.map(c => enumStringIndex(context.docSet.enums.wordLike, c));
          ret = ret.filter(b => context.docSet.blockHasChars(b, charsIndexes));
        }
        return ret;
      },
    },
    itemGroups: {
      type: GraphQLNonNull(GraphQLList(GraphQLNonNull(itemGroupType))),
      args: {
        byScopes: { type: GraphQLList(GraphQLNonNull(GraphQLString)) },
        byMilestones: { type: GraphQLList(GraphQLNonNull(GraphQLString)) },
        includeContext: { type: GraphQLBoolean },
      },
      resolve: (root, args, context) => {
        if (args.byScopes && args.byMilestones) {
          throw new Error('Cannot specify both byScopes and byMilestones');
        }

        if (!args.byScopes && !args.byMilestones) {
          throw new Error('Must specify either byScopes or byMilestones');
        }

        if (args.byScopes) {
          return context.docSet.sequenceItemsByScopes(root.blocks, args.byScopes, args.includeContext || false);
        } else {
          return context.docSet.sequenceItemsByMilestones(root.blocks, args.byMilestones, args.includeContext || false);
        }
      },
    },
    tags: {
      type: GraphQLNonNull(GraphQLList(GraphQLNonNull(GraphQLString))),
      resolve: root => Array.from(root.tags),
    },
    hasTag: {
      type: GraphQLNonNull(GraphQLBoolean),
      args: { tagName: { type: GraphQLNonNull(GraphQLString) } },
      resolve: (root, args) => root.tags.has(args.tagName),
    },
  }),
});

module.exports = sequenceType;