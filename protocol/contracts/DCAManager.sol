// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.9;

// inheritance
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

// interfaces
import "./interfaces/IERC20.sol";
import "./interfaces/IUniswapV2Pair.sol";
import "./interfaces/IUniswapV2Router02.sol";

// libraries
import "./libraries/UniswapV2Library.sol";

contract DCAManager is ReentrancyGuard, AccessControlEnumerable {
    using Counters for Counters.Counter;

    struct TokenStrategy {
        address outputToken;
        address[] buyPath; // token path to take for trades -- USDC -> Token
        address[] sellPath; // token path to take for trades -- Token -> USDC
    }

    struct TradingStrategy {
        uint256 maxDepth; // the maximum number of buy orders for this bot
        uint256[] requiredPercentForSell; // percent for price to increase for a given depth to sell all entries
        uint256[] requiredPercentForBuy; // percent to buy at a given depth
        uint256[] amountProportions; // the proportion of total funds to use at each depth
    }
    bytes32 public immutable BOT_ADMIN_ROLE;
    bytes32 public immutable BOT_ROLE;

    bytes32 public immutable CONTRACT_OWNER_ROLE;

    // objId => obj
    mapping(uint256 => TradingStrategy) public tradingStrategies;
    mapping(uint256 => TokenStrategy) public tokenStrategies;

    uint256 private royalty_numerator;
    address private royalty_recipient;

    uint256 immutable PERCENT_DENOMINATOR;
    IERC20 immutable USDT;
    IUniswapV2Router02 immutable ROUTER;

    address private botAddress;

    Counters.Counter private tradingStrategyIncrementor;
    Counters.Counter private tokenStrategyIncrementor;

    event TradingStrategyAdded(
        uint256 Id,
        uint256 _maxDepth,
        uint256[] requiredPercentForSell,
        uint256[] requiredPercentForBuy,
        uint256[] amountProportions
    );

    event TokenStrategyAdded(
        uint256 Id,
        address tokenAddress,
        address[] buyPath,
        address[] sellPath
    );

    /**
     *
     * BSC USDT:
     * Pancake Router:
     *
     */
    constructor(
        address _usdt,
        address _router,
        address _owner,
        address _botAddress
        // address _royaltyRecipient
    ) {
        BOT_ROLE = keccak256("BOT_ROLE");
        CONTRACT_OWNER_ROLE = keccak256("CONTRACT_OWNER_ROLE");
        BOT_ADMIN_ROLE = keccak256("BOT_ADMIN_ROLE");

        require(_usdt != address(0), "1");
        require(_router != address(0), "2");
        require(_owner != address(0), "4");
        require(_botAddress != address(0), "4");

        botAddress = _botAddress;
        royalty_numerator = 1_000;
        // royalty_recipient = _royaltyRecipient;

        USDT = IERC20(_usdt);
        ROUTER = IUniswapV2Router02(_router);
        PERCENT_DENOMINATOR = 1_000_000;

        // start at 1 for Ids
        tradingStrategyIncrementor.increment();
        tokenStrategyIncrementor.increment();

        // setup role admins
        _setRoleAdmin(BOT_ROLE, BOT_ADMIN_ROLE);

        // grant admins
        _setupRole(BOT_ADMIN_ROLE, _owner);

        // grant roles
        _setupRole(CONTRACT_OWNER_ROLE, _owner);
        _setupRole(BOT_ROLE, _owner);
        _setupRole(BOT_ROLE, _msgSender());
    }

    /**
     *
     * @dev this function creates a trading strategy for use with any token strategy
     *
     * @param _maxDepth the maximum number of open line orders to accumulate
     * @param _requiredPercentForSell the required percent for the price to change for a
     * certain depth to trigger a sell off for all depths above
     * @param _requiredPercentForBuy the required percent for the price to increase in order to purchase another depth item
     * @param _amountProportions the relative order size at each depth
     *
     * @notice length mismatch between buys and sells for depth n, this is because only n deviatinos have to occur for 'buying
     *  in' while a maximum of n + 1 deviations must occur to trigger sell offs for all depths
     *
     */
    function createTradingStrategy(
        uint256 _maxDepth,
        uint256[] memory _requiredPercentForSell,
        uint256[] memory _requiredPercentForBuy,
        uint256[] memory _amountProportions
    ) public onlyRole(BOT_ROLE) {
        require(
            (_maxDepth + 1) == _amountProportions.length,
            "amountProportions"
        );

        require(_maxDepth == _requiredPercentForBuy.length, "buy");

        require((_maxDepth + 1) == _requiredPercentForSell.length, "sell");

        // create the bot template
        TradingStrategy storage tradingStrategy = tradingStrategies[
            tradingStrategyIncrementor.current()
        ];

        tradingStrategy.maxDepth = _maxDepth;
        tradingStrategy.requiredPercentForSell = _requiredPercentForSell;
        tradingStrategy.requiredPercentForBuy = _requiredPercentForBuy;
        tradingStrategy.amountProportions = _amountProportions;

        emit TradingStrategyAdded(
            tokenStrategyIncrementor.current(),
            _maxDepth,
            _requiredPercentForSell,
            _requiredPercentForBuy,
            _amountProportions
        );

        // increment strategy tracker
        tradingStrategyIncrementor.increment();
    }

    /**
     *
     * @dev this function creates a token strategy for use with any trading strategy
     *
     * @param _outputToken the output token to track the price of
     * @param _buyPath the buy path from purchase token to output token
     * @param _sellPath the sell path from purchase token to output token
     *
     * @notice The contract will only accept 18 decimal tokens -- stablecoin purchaser mut be 18 decimals
     *
     * The sell path is allowed to be different than the reverse of the buyPath;
     * however, in most cases the expectation is the sell path to be the simple reverse of hte buy path
     *
     */
    function createTokenStrategy(
        address _outputToken,
        address[] memory _buyPath,
        address[] memory _sellPath
    ) external {
        require(IERC20(_outputToken).decimals() == 18, "decimals MUST be 18");

        require(
            _buyPath[0] == address(USDT) &&
                _buyPath[_buyPath.length - 1] == _outputToken,
            "input and output token mismatch"
        );

        require(
            _sellPath[0] == _outputToken &&
                _sellPath[_sellPath.length - 1] == address(USDT),
            "input and output token mismatch"
        );

        // create the bot template
        TokenStrategy storage tokenStrategy = tokenStrategies[
            tokenStrategyIncrementor.current()
        ];

        tokenStrategy.outputToken = _outputToken;
        tokenStrategy.buyPath = _buyPath;
        tokenStrategy.sellPath = _sellPath;

        emit TokenStrategyAdded(
            tokenStrategyIncrementor.current(),
            _outputToken,
            _buyPath,
            _sellPath
        );

        // increment strategy tracker
        tokenStrategyIncrementor.increment();
    }

    /**
     *
     * @return uint256 the next Id for trading strategy
     *
     */
    function getTradingStrategyNextId() external view returns (uint256) {
        return tradingStrategyIncrementor.current();
    }

    /**
     *
     * @return uint256 the next Id for token strategy
     *
     */
    function getTokenStrategyNextId() external view returns (uint256) {
        return tokenStrategyIncrementor.current();
    }

    /**
     *
     * @return uint256[] max depth for strategyId
     *
     */
    function getTradingStrategyMaxDepth(uint256 _tradingStrategyId)
        external
        view
        returns (uint256)
    {
        return tradingStrategies[_tradingStrategyId].maxDepth;
    }

    /**
     *
     * @return uint256[] percent for price to increase for a given depth to sell all entries
     *
     */
    function getTradingStrategyRequiredPercentForSell(
        uint256 _tradingStrategyId
    ) external view returns (uint256[] memory) {
        return tradingStrategies[_tradingStrategyId].requiredPercentForSell;
    }

    /**
     *
     * @return uint256 requiredPercentForBuy
     *
     */
    function getTradingStrategyRequiredPercentForBuy(uint256 _tradingStrategyId)
        external
        view
        returns (uint256[] memory)
    {
        return tradingStrategies[_tradingStrategyId].requiredPercentForBuy;
    }

    /**
     *
     * uint256[] amountProportions;
     *
     */
    function getTradingStrategyAmountProportions(uint256 _tradingStrategyId)
        external
        view
        returns (uint256[] memory)
    {
        return tradingStrategies[_tradingStrategyId].amountProportions;
    }

    /**
     *
     * @dev returns the buy path for a given token strategy Id
     *
     */
    function getTokenStrategyBuyPath(uint256 _tokenStrategyId)
        external
        view
        returns (address[] memory)
    {
        return tokenStrategies[_tokenStrategyId].buyPath;
    }

    /**
     *
     * @dev returns the sell path for a given token strategy Id
     *
     */
    function getTokenStrategySellPath(uint256 _tokenStrategyId)
        external
        view
        returns (address[] memory)
    {
        return tokenStrategies[_tokenStrategyId].sellPath;
    }

    /**
     *
     * @dev return the output token to return for the given tokenStrategyId
     *
     */
    function getTokenStrategyOutputToken(uint256 _tokenStrategyId)
        external
        view
        returns (address)
    {
        return tokenStrategies[_tokenStrategyId].outputToken;
    }

    /**
     *
     * @dev botAddress
     *
     */
    function getBotAddress() external view returns (address) {
        return botAddress;
    }

    /**
     *
     * @dev royalty info
     *
     */
    function royaltyInfo(uint256 _profit)
        external
        view
        returns (address to, uint256 amount)
    {
        // calculate royalty fee
        uint256 royaltyAmount = ((_profit * royalty_numerator) /
            PERCENT_DENOMINATOR);
        return (royalty_recipient, royaltyAmount);
    }

    /**
     *
     * @dev set the roylaty fee
     *
     */
    function setRoyaltyFee(uint256 _fee)
        external
        onlyRole(CONTRACT_OWNER_ROLE)
    {
        royalty_numerator = _fee;
    }

    /**
     *
     * @dev set the recipient of the royalty
     *
     */
    function setRoyaltyRecipient(address _recipient)
        external
        onlyRole(CONTRACT_OWNER_ROLE)
    {
        royalty_recipient = _recipient;
    }

    /**
     *
     * @dev input amount is assumed to be a usdt attached pegged to $1,
     * this will always return an expected output amount for a token given a
     * valid buyPath for the given token that results in terms of the $usdt
     *
     * @param _inputAmount amount of stablecoin
     * @param _tokenStrategyId Id of the token strategy to use
     *
     * @return output the output number of tokens to expect if a trade took place at this intant on chain
     * @return price the price in terms of USDT in 6 decimals
     *
     * @notice this trickery is what allows for 0 slippage from the DCA Controller Contract
     *
     */
    function getCurrentBuyInPrice(
        uint256 _inputAmount,
        uint256 _tokenStrategyId
    ) public view returns (uint256 output, uint256 price) {
        TokenStrategy memory tokenStrategy = tokenStrategies[_tokenStrategyId];

        // calculate price based on input amount
        uint256[] memory amountsOut = ROUTER.getAmountsOut(
            _inputAmount,
            tokenStrategy.buyPath
        );

        output = amountsOut[amountsOut.length - 1];

        price = (_inputAmount * (10**6)) / output;

        return (output, price);
    }

    /**
     *
     * @dev similar to getCurrentPrice but instead for the outputToken as the input
     *
     * @param _inputAmount amount of stablecoin
     * @param _tokenStrategyId Id of the token strategy to use
     *
     * @return output the output number of usdt tokens to expect if a trade took place at this intant on-chain
     * @return price the price of this sell trade
     *
     * @notice this trickery is what allows for 0 slippage from the DCA Controller Contract due to explicit calculation
     *
     */
    function getCurrentSellOffPrice(
        uint256 _inputAmount,
        uint256 _tokenStrategyId
    ) public view returns (uint256 output, uint256 price) {
        TokenStrategy memory tokenStrategy = tokenStrategies[_tokenStrategyId];

        // calculate price based on input amount of the token
        uint256[] memory amountsOut = ROUTER.getAmountsOut(
            _inputAmount,
            tokenStrategy.sellPath
        );

        output = amountsOut[amountsOut.length - 1];

        price = (output * (10**6)) / _inputAmount;

        return (output, price);
    }
}
