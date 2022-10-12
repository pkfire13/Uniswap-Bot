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
import "./DCAManager.sol";

// libraries
import "./libraries/UniswapV2Library.sol";

contract DCATrader is ReentrancyGuard, AccessControlEnumerable {
    using Counters for Counters.Counter;

    struct TokenStrategy {
        address outputToken;
        address[] buyPath; // token path to take for trades -- USDT -> STUFF -> Token
        address[] sellPath; // token path to take for trades -- Token -> STUFF ->  USDT
    }

    struct TradingStrategy {
        uint256 maxDepth; // the maximum number of buy orders for this bot
        uint256[] requiredPercentForSell; // percent for price to increase for a given depth to sell all entries
        uint256[] requiredPercentForBuy; // percent to buy at a given depth
        uint256[] amountProportions; // the proportion of total funds to use at each depth
    }

    struct Bot {
        address owner; // owner of the bot Id -- only the owner can close position
        bool destroyed; // bool representing if this bot is active
        uint256 tradingStrategyId; // integer Id for the trading startegy
        uint256 tokenStrategyId; // integer Id for the token strategy
        uint256 entryFunds; // amount of usdt, this bot was opened with
        uint256 currentDepth; // current depth of the bot, ie: 3 would represent 3 sets of orders have been placed AFTER entry
        uint256[] sellThresholds; // raw integer value of total price to sell at for each depth
        uint256[] buyThresholds; // raw integer value of total price to buy in at for each depth
        uint256[] buyAmounts; // raw integer value of total amount to buy in at each depth level
        uint256 initPrice; // first price
        uint256 usdtBalance; // usdt balance for this bot on the current period
        uint256 tokenBalance; // token balance for this bot
        uint256 gasBill; // gas accumulation for this botId
    }

    bytes32 public immutable BOT_ADMIN_ROLE;
    bytes32 public immutable BOT_ROLE;

    bytes32 public immutable CONTRACT_OWNER_ROLE;

    // bot id => bot info
    mapping(uint256 => Bot) public bots;
    mapping(address => bool) public royaltyWhitelist;

    uint256 public global_slippage;
    uint256 public global_delay;

    uint256 immutable PERCENT_DENOMINATOR;
    IERC20 immutable USDT;

    IUniswapV2Router02 immutable ROUTER;
    DCAManager immutable MANAGER;

    Counters.Counter private botIncrementor;

    /**
     *
     * Events
     *
     */
    event BotCreated(address indexed owner, uint256 indexed botId);

    event BotInitialized(
        address indexed owner,
        uint256 indexed botId,
        uint256 indexed totalFunds
    );

    event BotClosed(
        address indexed owner,
        uint256 indexed botId,
        uint256 usdtAmount
    );

    event BotRunSuccess(address indexed owner, uint256 indexed botId);

    /**
     *
     * Stuff
     *
     */
    constructor(
        address _usdt,
        address _router,
        address _owner,
        address _manager
    ) {
        BOT_ROLE = keccak256("BOT_ROLE");
        CONTRACT_OWNER_ROLE = keccak256("CONTRACT_OWNER_ROLE");
        BOT_ADMIN_ROLE = keccak256("BOT_ADMIN_ROLE");

        require(_usdt != address(0), "1");
        require(_router != address(0), "2");
        require(_owner != address(0), "3");
        require(_manager != address(0), "4");

        global_slippage = 1; // 0.0001% slippage; effectively 0%
        global_delay = 60; // 60s maximum wait time for going through

        PERCENT_DENOMINATOR = 1_000_000;
        USDT = IERC20(_usdt);
        ROUTER = IUniswapV2Router02(_router);
        MANAGER = DCAManager(_manager);

        // start at 1
        botIncrementor.increment();
        bots[0].destroyed = true;

        // give the router infinite approval for usdt
        USDT.approve(_router, 9999999999999999999999999999999999999999999999);

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
     * @dev Creates a new bot with parameters governing
     *
     * @param _tradingStrategyId uint of the trading strategy to use
     * @param _tokenStrategyId uint of the tokenstrategy to use
     * @param _totalFunds the number of native decimals tokens of usdt to enter with
     *
     */
    function enter(
        uint256 _tradingStrategyId,
        uint256 _tokenStrategyId,
        uint256 _totalFunds
    ) public {
        require(
            _tradingStrategyId < MANAGER.getTradingStrategyNextId() &&
                _tradingStrategyId > 0,
            "DCATradingBot: invalid trading Id"
        );

        require(
            _tokenStrategyId < MANAGER.getTokenStrategyNextId() &&
                _tokenStrategyId > 0,
            "DCATradingBot: invalid token Id"
        );

        // infinitely approve the token trading
        IERC20(MANAGER.getTokenStrategyOutputToken(_tokenStrategyId)).approve(
            address(ROUTER),
            99999999999999999999999999999999999999
        );

        // transfer total funds to the contract under the proper bot id
        require(USDT.transferFrom(_msgSender(), address(this), _totalFunds));

        // assign the Id and init values
        Bot storage bot = bots[botIncrementor.current()];
        bot.tradingStrategyId = _tradingStrategyId;
        bot.tokenStrategyId = _tokenStrategyId;
        bot.entryFunds = _totalFunds;
        bot.owner = _msgSender();

        // purchase initial position
        require(
            _initializeBot(_totalFunds, botIncrementor.current()),
            "DCATradingBot: init failed"
        );

        emit BotCreated(bot.owner, botIncrementor.current());

        // increment bot Ids
        botIncrementor.increment();
    }

    /**
     *
     * @dev used to initilize a bot baed on Id
     *
     * @param _totalFunds the total amount of USDT in native decimals to allocate to this bot (enter or reenter with)
     * @param _botId the Id to run this bot under
     *
     * @notice when reinitializing a previously used Id, grid data must be overidden
     *
     */
    function _initializeBot(uint256 _totalFunds, uint256 _botId)
        internal
        returns (bool)
    {
        Bot storage bot = bots[_botId];

        // reset specific storage data for this bot Id
        delete bot.buyAmounts;
        delete bot.buyThresholds;
        delete bot.sellThresholds;
        delete bot.currentDepth;

        for (
            uint256 i;
            i < MANAGER.getTradingStrategyMaxDepth(bot.tradingStrategyId) + 1;
            ++i
        ) {
            bot.buyAmounts.push(
                ((_totalFunds *
                    MANAGER.getTradingStrategyAmountProportions(
                        bot.tradingStrategyId
                    )[i]) / PERCENT_DENOMINATOR)
            );
        }

        (uint256 amountOutMax, uint256 price) = MANAGER.getCurrentBuyInPrice(
            bot.buyAmounts[0],
            bot.tokenStrategyId
        );

        // entry order execution
        uint256[] memory amounts = ROUTER.swapExactTokensForTokens(
            bot.buyAmounts[0],
            amountOutMax,
            // (amountOutMax -
            //     ((amountOutMax * global_slippage) / PERCENT_DENOMINATOR)),
            MANAGER.getTokenStrategyBuyPath(bot.tokenStrategyId),
            address(this),
            block.timestamp + global_delay
        );

        // price is etablished as price.xxxxxx to maintain usdt decimal accuracy
        // establish on-chain price w/ the decimal difference based on first swap
        bot.initPrice = price;

        // create all threshold integer values for this given price - store them within array;
        for (
            uint256 j;
            j < MANAGER.getTradingStrategyMaxDepth(bot.tradingStrategyId);
            ++j
        ) {
            // calculate the buy price: lower
            bot.buyThresholds.push(
                bot.initPrice -
                    (MANAGER.getTradingStrategyRequiredPercentForBuy(
                        bot.tradingStrategyId
                    )[j] * bot.initPrice) /
                    PERCENT_DENOMINATOR
            );
        }

        for (
            uint256 k;
            k < MANAGER.getTradingStrategyMaxDepth(bot.tradingStrategyId) + 1;
            ++k
        ) {
            // calculate the sell price: higher
            // sellThreshold for buy order 1 is based on init price, the rest of the thresholds are based on the previous buyOrder
            // buy thresholds = sellthresholds.length - 1
            if (k == 0) {
                bot.sellThresholds.push(
                    bot.initPrice +
                        (MANAGER.getTradingStrategyRequiredPercentForSell(
                            bot.tradingStrategyId
                        )[k] * bot.initPrice) /
                        PERCENT_DENOMINATOR
                );
            } else {
                bot.sellThresholds.push(
                    bot.buyThresholds[k - 1] +
                        (MANAGER.getTradingStrategyRequiredPercentForSell(
                            bot.tradingStrategyId
                        )[k] * bot.buyThresholds[k - 1]) /
                        PERCENT_DENOMINATOR
                );
            }
        }

        bot.usdtBalance = _totalFunds - bot.buyAmounts[0];
        bot.tokenBalance = bot.tokenBalance + amounts[amounts.length - 1];

        emit BotInitialized(bot.owner, _botId, _totalFunds);

        return true;
    }

    /**
     *
     * @dev returns USDT only and destroys the bot
     *
     * @param _botId Id of the bot -- must be valid
     *
     * @notice gasBill must be paid in order to allow closing of bot through this function
     *
     */
    function closeBot(uint256 _botId) external payable nonReentrant {
        require(msg.value == bots[_botId].gasBill, "DCATrader: gas bill");
        (bool success, ) = MANAGER.getBotAddress().call{value: msg.value}("");
        require(success, "DCATrader: Transfer to bot address failed.");

        require(bots[_botId].owner == _msgSender(), "DCATradingBot: owner?");
        Bot storage bot = bots[_botId];

        require(
            (!bot.destroyed && (_botId < botIncrementor.current())),
            "DCATradingBot: invalid Id"
        );

        (uint256 amountOutMax, ) = MANAGER.getCurrentSellOffPrice(
            bot.tokenBalance,
            bot.tokenStrategyId
        );

        // return all funds for this bot by selling out all positions to usdt
        // entry order execution
        uint256[] memory amounts = ROUTER.swapExactTokensForTokens(
            bot.tokenBalance,
            amountOutMax,
            // (amountOutMax -
            //     ((amountOutMax * global_slippage) / PERCENT_DENOMINATOR)),
            MANAGER.getTokenStrategySellPath(bot.tokenStrategyId),
            address(this),
            block.timestamp + global_delay
        );

        // entry order execution
        bot.usdtBalance = bot.usdtBalance + amounts[amounts.length - 1];
        bot.tokenBalance = 0;

        require((bot.usdtBalance > 0), "DCATradingBot: no balance to withdraw");

        // caluclate royalties

        if (
            !royaltyWhitelist[_msgSender()] &&
            bots[_botId].entryFunds < bots[_botId].usdtBalance
        ) {
            // profit calculation
            uint256 profit = bots[_botId].usdtBalance - bots[_botId].entryFunds;
            if (profit > 1e9) {
                (address to, uint256 amount) = MANAGER.royaltyInfo(profit);
                USDT.transfer(to, amount);
                bots[_botId].usdtBalance -= amount;
            }
        }

        USDT.transfer(_msgSender(), bots[_botId].usdtBalance);

        emit BotClosed(bot.owner, _botId, bots[_botId].usdtBalance);

        // destroy bot
        bot.destroyed = true;
        bot.usdtBalance = 0;
        bot.gasBill = 0;
    }

    /**
     *
     * @dev running
     *
     * @notice 3 paths:
     * 1. price is high enough, sell -> reinitializes instantly
     * 2. price is low enough, buy more
     * 3. price has not changed enough no tx occurs
     *
     */
    function run(uint256 botId) public nonReentrant onlyRole(BOT_ROLE) {
        uint256 startingGas = gasleft() + 21000;
        require(
            !bots[botId].destroyed && (botId < botIncrementor.current()),
            "DCATradingBot: invalid Id"
        );

        require(
            _sellOff(botId) || _buyIn(botId),
            "DCATradingBot: nothing to trade"
        );

        emit BotRunSuccess(bots[botId].owner, botId);

        // accumulate gas bill for this bot Id
        uint256 endingGas = startingGas - gasleft();
        bots[botId].gasBill += (endingGas * tx.gasprice);
    }

    /**
     *
     * @dev internal buyIn logic
     *
     */
    function _buyIn(uint256 botId) internal returns (bool) {
        Bot storage bot = bots[botId];

        // max depth has been reached
        if (
            bot.currentDepth ==
            MANAGER.getTradingStrategyMaxDepth(bot.tradingStrategyId)
        ) {
            return false;
        }

        (uint256 outputAmount, uint256 price) = MANAGER.getCurrentBuyInPrice(
            bot.buyAmounts[bot.currentDepth + 1],
            bot.tokenStrategyId
        );

        // check current depth and compare thresholds
        if (price <= bot.buyThresholds[bot.currentDepth]) {
            // buy in to the next depth at the correct amounts
            // entry order execution
            uint256[] memory amounts = ROUTER.swapExactTokensForTokens(
                bot.buyAmounts[bot.currentDepth + 1],
                outputAmount,
                // (outputAmount -
                //     ((outputAmount * global_slippage) / PERCENT_DENOMINATOR)),
                MANAGER.getTokenStrategyBuyPath(bots[botId].tokenStrategyId),
                address(this),
                block.timestamp + global_delay
            );

            // update balances for this bot
            bot.usdtBalance -= bot.buyAmounts[bot.currentDepth + 1];
            bot.tokenBalance = bot.tokenBalance + amounts[amounts.length - 1];

            // increase depth
            bot.currentDepth += 1;

            return true;
        }
        return false;
    }

    /**
     *
     * @dev internal sell off
     *
     */
    function _sellOff(uint256 _botId) internal returns (bool) {
        // check this bot's fulfillment
        Bot storage bot = bots[_botId];

        (uint256 amountOutMax, uint256 price) = MANAGER.getCurrentSellOffPrice(
            bot.tokenBalance,
            bot.tokenStrategyId
        );

        // check current depth and compare thresholds
        if (price >= bot.sellThresholds[bot.currentDepth]) {
            // entry order execution
            uint256[] memory amounts = ROUTER.swapExactTokensForTokens(
                bot.tokenBalance,
                amountOutMax,
                // (amountOutMax -
                //     ((amountOutMax * global_slippage) / PERCENT_DENOMINATOR)),
                MANAGER.getTokenStrategySellPath(bot.tokenStrategyId),
                address(this),
                block.timestamp + global_delay
            );

            // update balances for this bot
            bot.usdtBalance += amounts[amounts.length - 1];
            bot.tokenBalance = 0;

            // reset to depth = 0 and reinit
            bot.currentDepth = 0;

            _initializeBot(bot.usdtBalance, _botId);

            return true;
        }

        return false;
    }

    /**
     *
     * @dev returns ALL tokens in the contract for the given token address
     *
     * @notice logic within the contract after this point will be bricked
     *
     */
    function adminReturnTokens(address token)
        external
        onlyRole(CONTRACT_OWNER_ROLE)
    {
        require(token != address(0), "DCATradingBot: address 0");

        IERC20(token).transfer(
            _msgSender(),
            IERC20(token).balanceOf(address(this))
        );
    }

    /**
     *
     * @dev this function will exist in lieu of the adminReturnTokens functinos,
     * so that only a owner of tokens can retrieve their tokens, effectively
     * bricking whatever bot Id they may be running
     *
     */
    function lastResortUserWithdraw(uint256 _botId) external {
        // transfer direct tokens for the botId to the user
        // destroy bot
    }

    /**
     *
     * @dev allow for updating the global slippage
     *
     */
    function updateGlobalSlippage(uint256 slippage)
        external
        onlyRole(CONTRACT_OWNER_ROLE)
    {
        global_slippage = slippage;
    }

    /** View Segment */
    function isFulfillable(uint256 botId) external view returns (bool) {
        Bot storage bot = bots[botId];

        /* sell block */
        (uint256 unused_2, uint256 sellPrice) = MANAGER.getCurrentSellOffPrice(
            bot.tokenBalance,
            bot.tokenStrategyId
        );

        // check current depth and compare thresholds
        if (sellPrice >= bot.sellThresholds[bot.currentDepth]) {
            return true;
        }

        /* buy block */
        if (
            bot.currentDepth ==
            MANAGER.getTradingStrategyMaxDepth(bot.tradingStrategyId)
        ) {
            return false;
        }

        (uint256 unused_1, uint256 buyPrice) = MANAGER.getCurrentBuyInPrice(
            bot.buyAmounts[bot.currentDepth + 1],
            bot.tokenStrategyId
        );

        // check current depth and compare thresholds
        if (buyPrice <= bot.buyThresholds[bot.currentDepth]) {
            return true;
        } else {
            return false;
        }
    }

    /**
     *
     *
     *
     */
    function getBotNextId() external view returns (uint256) {
        return botIncrementor.current();
    }

    /**
     *
     *
     *
     */
    function getBotSellThresholds(uint256 botId)
        external
        view
        returns (uint256[] memory)
    {
        return bots[botId].sellThresholds;
    }

    /**
     *
     *
     *
     */
    function getBotBuyThresholds(uint256 botId)
        external
        view
        returns (uint256[] memory)
    {
        return bots[botId].buyThresholds;
    }

    /**
     *
     *
     *
     */
    function getBotBuyAmounts(uint256 botId)
        external
        view
        returns (uint256[] memory)
    {
        return bots[botId].buyAmounts;
    }
}
