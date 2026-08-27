// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PaymentReceipt
 * @notice x402 ödemeleri için zincir üstü makbuz (ERC-721).
 *
 * Her başarılı settlement'tan sonra sunucu, ödemeyi yapan cüzdana ücretsiz bir
 * makbuz basar. Makbuz alıcının kendi cüzdanında durur ve ödemenin zincir üstü
 * kanıtıdır.
 *
 * Kontrat bilinçli olarak paketlerden ve fiyatlardan habersizdir: yalnızca
 * kendisine verilen tokenURI'yi saklar. Paket adı, tutar, ağ ve zaman damgası
 * çağıran tarafın ürettiği metadata JSON'unun içindedir (bkz. api/_receipt.ts),
 * böylece yeni bir paket eklemek kontrat değişikliği gerektirmez.
 *
 * @dev OpenZeppelin Contracts 5.6.1 ile derlenir.
 */
contract PaymentReceipt is ERC721, ERC721URIStorage, Ownable {
    /**
     * @dev Bir sonraki token kimliği. Basımdan ÖNCE artırıldığı için ilk makbuz
     * 1 numaradır; 0 "makbuz yok" anlamına gelir ve karışıklık çıkarmaz.
     */
    uint256 private _nextTokenId;

    /// @notice Bir makbuzun basıldığını bildirir.
    event ReceiptMinted(address indexed to, uint256 indexed tokenId);

    /**
     * @param initialOwner Basım yetkisi olan adres — projenin sunucu cüzdanı.
     */
    constructor(
        address initialOwner
    ) ERC721("x402 Payment Receipt", "X402R") Ownable(initialOwner) {}

    /**
     * @notice Bir makbuz basar.
     * @dev Yalnızca sahip (projenin sunucu cüzdanı) çağırabilir. Basım herkese
     * açık olsaydı, ödeme yapmamış biri kendine sınırsız sahte makbuz basabilir
     * ve makbuzun kanıt değeri kalmazdı.
     *
     * `_safeMint` kullanılıyor: alıcı ERC-721 kabul edemeyen bir kontratsa çağrı
     * revert eder. Sunucu bunu en-iyi-çaba olarak ele alır (bkz. api/_receipt.ts)
     * ve başarısız basım ödemeyi hiçbir şekilde etkilemez.
     *
     * @param to  Makbuzun gideceği adres — ödemeyi yapan cüzdan.
     * @param uri Tam metadata URI'si; data:application/json;base64,… beklenir.
     * @return Basılan makbuzun kimliği.
     */
    function mint(
        address to,
        string memory uri
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit ReceiptMinted(to, tokenId);
        return tokenId;
    }

    /// @notice Bugüne kadar basılan makbuz sayısı.
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @notice Bir sonraki makbuzun alacağı kimlik.
     * @dev Sunucu, bileti basmadan önce üzerine yazacağı seri numarasını
     * buradan öğrenir. Görselin içinde seri numarası olduğu ve numara ancak
     * mint sırasında belli olduğu için, tokenURI'nin doğru numarayla
     * üretilebilmesi gerekiyor.
     */
    function nextTokenId() external view returns (uint256) {
        return _nextTokenId + 1;
    }

    /**
     * @notice Var olan bir makbuzun URI'sini değiştirir.
     * @dev Yalnızca sahip çağırabilir ve tek bir amacı var: eşzamanlı iki
     * basım araya girip biletin üzerine yanlış seri numarası yazdıysa onu
     * düzeltmek (bkz. api/_receipt.ts). Kalıcı bir ödeme kanıtının üzerinde
     * yanlış numara durmasındansa düzeltilebilir olması yeğdir.
     */
    function setTokenURI(uint256 tokenId, string memory uri) external onlyOwner {
        // _requireOwned, var olmayan bir token için revert eder.
        _requireOwned(tokenId);
        _setTokenURI(tokenId, uri);
    }

    // --- Çoklu kalıtım için gereken override'lar ---

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
