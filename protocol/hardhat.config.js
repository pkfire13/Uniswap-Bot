/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("@nomiclabs/hardhat-waffle");

module.exports = {
	solidity: "0.8.9",
	networks: {
		goerli: {
			url: "https://eth-goerli.g.alchemy.com/v2/34BVwmF13BrlKAAoxc-W2LLkpo1csDHx",
			accounts: [
				"",
			],
		},
	},
};
