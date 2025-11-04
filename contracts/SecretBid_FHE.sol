pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecretBid_FHE is ZamaEthereumConfig {
    struct Auction {
        string nftId;
        uint256 startTime;
        uint256 endTime;
        address highestBidder;
        euint32 highestBid;
        bool isActive;
    }

    struct Bid {
        address bidder;
        euint32 encryptedBid;
        uint256 timestamp;
    }

    mapping(string => Auction) public auctions;
    mapping(string => Bid[]) public bids;
    mapping(string => bool) public auctionExists;

    event AuctionCreated(string indexed nftId, uint256 startTime, uint256 endTime);
    event BidPlaced(string indexed nftId, address indexed bidder);
    event AuctionConcluded(string indexed nftId, address winner, uint32 winningBid);

    modifier onlyActiveAuction(string calldata nftId) {
        require(auctionExists[nftId], "Auction does not exist");
        require(auctions[nftId].isActive, "Auction is not active");
        require(block.timestamp >= auctions[nftId].startTime, "Auction has not started");
        require(block.timestamp <= auctions[nftId].endTime, "Auction has ended");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function createAuction(
        string calldata nftId,
        uint256 duration
    ) external {
        require(!auctionExists[nftId], "Auction already exists");
        uint256 startTime = block.timestamp;
        uint256 endTime = startTime + duration;

        auctions[nftId] = Auction({
            nftId: nftId,
            startTime: startTime,
            endTime: endTime,
            highestBidder: address(0),
            highestBid: FHE.zero(16),
            isActive: true
        });
        auctionExists[nftId] = true;

        emit AuctionCreated(nftId, startTime, endTime);
    }

    function placeBid(
        string calldata nftId,
        externalEuint32 encryptedBid,
        bytes calldata inputProof
    ) external onlyActiveAuction(nftId) {
        euint32 encryptedBidValue = FHE.fromExternal(encryptedBid, inputProof);
        require(FHE.isInitialized(encryptedBidValue), "Invalid encrypted bid");

        Bid memory newBid = Bid({
            bidder: msg.sender,
            encryptedBid: encryptedBidValue,
            timestamp: block.timestamp
        });
        bids[nftId].push(newBid);

        if (FHE.gt(encryptedBidValue, auctions[nftId].highestBid)) {
            auctions[nftId].highestBid = encryptedBidValue;
            auctions[nftId].highestBidder = msg.sender;
        }

        FHE.allowThis(encryptedBidValue);
        FHE.makePubliclyDecryptable(encryptedBidValue);

        emit BidPlaced(nftId, msg.sender);
    }

    function concludeAuction(
        string calldata nftId,
        bytes memory abiEncodedClearBid,
        bytes memory decryptionProof
    ) external {
        require(auctionExists[nftId], "Auction does not exist");
        require(block.timestamp > auctions[nftId].endTime, "Auction is still active");
        require(auctions[nftId].isActive, "Auction already concluded");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(auctions[nftId].highestBid);

        FHE.checkSignatures(cts, abiEncodedClearBid, decryptionProof);

        uint32 winningBid = abi.decode(abiEncodedClearBid, (uint32));
        address winner = auctions[nftId].highestBidder;

        auctions[nftId].isActive = false;

        emit AuctionConcluded(nftId, winner, winningBid);
    }

    function getHighestBid(string calldata nftId) external view returns (euint32) {
        require(auctionExists[nftId], "Auction does not exist");
        return auctions[nftId].highestBid;
    }

    function getAuctionDetails(string calldata nftId) external view returns (
        string memory,
        uint256,
        uint256,
        address,
        bool
    ) {
        require(auctionExists[nftId], "Auction does not exist");
        Auction storage auction = auctions[nftId];
        return (
            auction.nftId,
            auction.startTime,
            auction.endTime,
            auction.highestBidder,
            auction.isActive
        );
    }

    function getBidCount(string calldata nftId) external view returns (uint256) {
        require(auctionExists[nftId], "Auction does not exist");
        return bids[nftId].length;
    }

    function getBid(string calldata nftId, uint256 index) external view returns (
        address,
        euint32,
        uint256
    ) {
        require(auctionExists[nftId], "Auction does not exist");
        require(index < bids[nftId].length, "Invalid bid index");
        Bid storage bid = bids[nftId][index];
        return (bid.bidder, bid.encryptedBid, bid.timestamp);
    }
}


