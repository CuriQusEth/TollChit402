// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TollChit402
/// @notice A "proof of passage" NFT minted to the payer after every successful x402
///         payment on TollChit402. Metadata is stored fully on-chain as a base64
///         data URI, so the collection has no dependency on an external pinning
///         service (IPFS, Pinata, etc.).
/// @dev Only the contract owner (TollChit402's backend/server wallet) can mint.
///      Minting is intentionally NOT open to the public to prevent spam mints.
contract TollChit402 is ERC721, ERC721URIStorage, Ownable {
    /// @notice The token id that will be assigned to the next mint.
    uint256 private _nextTokenId;

    /// @notice Emitted on every mint, for easy off-chain indexing/analytics.
    event ChitMinted(uint256 indexed tokenId, address indexed to, string uri);

    constructor(address initialOwner)
        ERC721("TollChit402", "CHIT402")
        Ownable(initialOwner)
    {}

    /// @notice Mints a receipt NFT to the payer of a successful x402 transaction.
    /// @param to  The wallet address that made the payment (and will receive the NFT).
    /// @param uri A fully on-chain `data:application/json;base64,...` token URI.
    /// @return tokenId The id of the newly minted token.
    function mint(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit ChitMinted(tokenId, to, uri);
        return tokenId;
    }

    /// @notice Returns how many TollChit402 receipts have been minted so far.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    // --- Required overrides for the ERC721 / ERC721URIStorage multiple inheritance ---

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
