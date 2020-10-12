const PreToken = require('./pretoken');

class AttributePT extends PreToken {

    constructor(subclass, matchedBits) {
        super(subclass);
        this.key = matchedBits[2];
        this.valueString = matchedBits[3].trim();
        this.values = this.valueString.replace("/","÷").split(",").map(vb => vb.trim());
        this.printValue = `| ${this.key}="${this.valueString}"`;
    }

}

module.exports = AttributePT;
