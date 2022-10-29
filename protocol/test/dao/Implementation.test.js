const { accounts, contract } = require("@openzeppelin/test-environment");
const { BN, expectRevert, expectEvent } = require("@openzeppelin/test-helpers");
const { expect } = require("chai");

const MockImpl = contract.fromArtifact("MockImplES005");
const MockV2Migrator = contract.fromArtifact("MockV2Migrator");
const MockUniswapV2PairLiquidity = contract.fromArtifact("MockUniswapV2PairLiquidity");
const MockToken = contract.fromArtifact("MockToken");
const MockPool = contract.fromArtifact("MockPool");
const Dollar = contract.fromArtifact("Dollar");

RESERVE_ADDRESS = "0x0000000000000000000000000000000000000000"
RATIO = "3216807417426974641"

describe.only("Implementation", function () {
  const [ownerAddress, userAddress, userAddress1, newOwner] = accounts;
  beforeEach(async function () {
    this.usdc = await MockToken.new("USD//C", "USDC", 18, {
      from: ownerAddress,
      gas: 8000000,
    });
    this.univ2 = await MockUniswapV2PairLiquidity.new({
      from: ownerAddress,
      gas: 8000000,
    });
    this.ess = await MockToken.new("Empty Set Share", "ESS", 18, {
      from: ownerAddress,
      gas: 8000000,
    });
    this.pool = await MockPool.new(this.usdc.address, {
      from: ownerAddress,
      gas: 8000000,
    });
    this.dao = await MockImpl.new(this.pool.address, this.ess.address, {
      from: ownerAddress,
      gas: 8000000,
    });
    this.dollar = await Dollar.at(await this.dao.dollar());
    this.migrator = await MockV2Migrator.new(RATIO, this.dao.address, this.dollar.address, this.ess.address, RESERVE_ADDRESS, {
      from: ownerAddress,
      gas: 8000000,
    });

    await this.pool.set(
      this.dao.address,
      this.dollar.address,
      this.univ2.address
    );

    await this.dao.setV2MigratorE(this.migrator.address);
    await this.dao.setOwnerE(ownerAddress);
  });

  describe("initialize", function () {
    beforeEach(async function () {
      // Mint ESS to Migrator
      await this.ess.mint(this.migrator.address, new BN("750_000_000_000_000_000_000_000_000"));

      // Setup claimable coupon underlying
      await this.dao.incrementBalanceOfCouponUnderlyingE(userAddress, 17, 1000000);

      await this.dao.initialize({ from: ownerAddress, gas: 8000000 });
    });

    it("mints remaining ESD", async function () {
      expect(await this.dollar.balanceOf(this.dao.address)).to.be.bignumber.equal(new BN(1000000));
    });

    it("sunsets migrator", async function () {
      expect(await this.ess.balanceOf(this.migrator.address)).to.be.bignumber.equal(new BN(0));
      expect(await this.ess.balanceOf(this.dao.address)).to.be.bignumber.equal(new BN(0));
      expect(await this.ess.balanceOf(ownerAddress)).to.be.bignumber.equal(new BN("750_000_000_000_000_000_000_000_000"));
    });
  });

  describe("poolWithdraw", async function () {
    beforeEach(async function () {
      // Pool claimable user
      await this.univ2.faucet(userAddress, 2000);
      await this.dao.mintToE(this.pool.address, 2000);
      await this.univ2.approve(this.pool.address, 2000, { from: userAddress });
      await this.pool.deposit(2000, { from: userAddress });
      await this.pool.bond(1000, { from: userAddress });

      // Pool claimable user1
      await this.univ2.faucet(userAddress1, 1000);
      await this.dao.mintToE(this.pool.address, 1000);
      await this.univ2.approve(this.pool.address, 1000, { from: userAddress1 });
      await this.pool.deposit(1000, { from: userAddress1 });
      await this.pool.bond(1000, { from: userAddress1 });

      // Pool rewarded
      await this.dao.mintToE(this.pool.address, 3000);

      // DAO total bonded
      await this.dao.incrementTotalBondedE(1000000);
      await this.dao.poolWithdrawSetup();

      // User Withdraw
      await this.dao.poolWithdraw({ from: userAddress });
      await this.dao.poolWithdraw({ from: userAddress1 });
    });

    it("withdraws the users' share", async function () {
      expect(await this.univ2.balanceOf(userAddress)).to.be.bignumber.equal(
        new BN(2000)
      );
      expect(await this.dollar.balanceOf(userAddress)).to.be.bignumber.equal(
        new BN(4500)
      );

      expect(await this.univ2.balanceOf(userAddress1)).to.be.bignumber.equal(
        new BN(1000)
      );
      expect(await this.dollar.balanceOf(userAddress1)).to.be.bignumber.equal(
        new BN(1500)
      );
    });

    it("marks the user as withdrawn", async function () {
      expect(await this.dao.poolHasWithdrawn(userAddress)).to.be.true;
      expect(await this.dao.poolHasWithdrawn(userAddress1)).to.be.true;
    });

    it("decrements the pool ESD withdrawable", async function () {
      expect(await this.dao.poolDollarWithdrawable()).to.be.bignumber.equal(
        new BN(0)
      );
    });
  });

  describe("commit", async function () {
    beforeEach(async function () {
      this.newImpl = await MockImpl.new(this.pool.address, this.ess.address, {
        from: userAddress,
        gas: 8000000,
      });
    });

    it("reverts for non-owners", async function () {
      await expectRevert(
        this.dao.commit(this.newImpl.address, {
          from: userAddress,
        }),
        "Permission: Not owner"
      );
    });

    it("allows the owner to call", async function () {
      const result = await this.dao.commit(this.newImpl.address, {
        from: ownerAddress,
        gas: 8000000,
      });
      await expectEvent.inTransaction(result.tx, MockImpl, "Commit", {
        account: ownerAddress,
        candidate: this.newImpl.address,
      });
    });
  });

  describe("changeOwner", async function () {
    it("reverts for non-owners", async function () {
      await expectRevert(
        this.dao.changeOwner(userAddress, {
          from: userAddress,
        }),
        "Permission: Not owner"
      );
    });

    it("allows the owner to call", async function () {
      const result = await this.dao.changeOwner(newOwner, {
        from: ownerAddress,
        gas: 8000000,
      });
      await expectEvent.inTransaction(result.tx, MockImpl, "OwnerChanged", {
        previousOwner: ownerAddress,
        newOwner: newOwner,
      });
    });
  });
});
