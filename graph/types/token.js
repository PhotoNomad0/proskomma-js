const {GraphQLObjectType, GraphQLString} = require('graphql');

const tokenType = new GraphQLObjectType({
    name: "Token",
    fields: () => ({
        subType: {type: GraphQLString, resolve: root => root[1]},
        chars: {type: GraphQLString, resolve: root => root[2]},
        dump: {type: GraphQLString, resolve: (root) => `${root[1]} '${root[2]}'`}
    })
})

module.exports = tokenType;