import { ethers, getNamedAccounts, network, deployments } from "hardhat";
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { BigNumber } from "ethers";
import {
  PNK,
  KlerosCore,
  DisputeKitClassic,
  SortitionModule,
  RandomizerRNG,
  RandomizerMock,
} from "../../typechain-types";
import { expect } from "chai";
import exp from "constants";

/* eslint-disable no-unused-vars */
/* eslint-disable no-unused-expressions */

describe("Staking", async () => {
  const ETH = (amount: number) => ethers.utils.parseUnits(amount.toString());
  const PNK = ETH;

  // 2nd court, 3 jurors, 1 dispute kit
  const extraData =
    "0x000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001";

  let deployer;
  let disputeKit;
  let pnk;
  let core;
  let sortition;
  let rng;
  let randomizer;

  const deploy = async () => {
    ({ deployer } = await getNamedAccounts());
    await deployments.fixture(["Arbitration"], {
      fallbackToGlobal: true,
      keepExistingDeployments: false,
    });
    disputeKit = (await ethers.getContract("DisputeKitClassic")) as DisputeKitClassic;
    pnk = (await ethers.getContract("PNK")) as PNK;
    core = (await ethers.getContract("KlerosCore")) as KlerosCore;
    sortition = (await ethers.getContract("SortitionModule")) as SortitionModule;
    rng = (await ethers.getContract("RandomizerRNG")) as RandomizerRNG;
    randomizer = (await ethers.getContract("RandomizerMock")) as RandomizerMock;
  };

  describe("When outside the Staking phase", async () => {
    let balanceBefore;

    const reachDrawingPhase = async () => {
      expect(await sortition.phase()).to.be.equal(0); // Staking
      const arbitrationCost = ETH(0.1).mul(3);

      await core.createCourt(1, false, PNK(1000), 1000, ETH(0.1), 3, [0, 0, 0, 0], 3, [1]); // Parent - general court, Classic dispute kit

      await pnk.approve(core.address, PNK(4000));
      await core.setStake(1, PNK(2000));
      await core.setStake(2, PNK(2000));

      expect(await core.getJurorCourtIDs(deployer)).to.be.deep.equal([BigNumber.from("1"), BigNumber.from("2")]);

      await core.functions["createDispute(uint256,bytes)"](2, extraData, { value: arbitrationCost });

      await network.provider.send("evm_increaseTime", [2000]); // Wait for minStakingTime
      await network.provider.send("evm_mine");

      const lookahead = await sortition.rngLookahead();
      await sortition.passPhase(); // Staking -> Generating
      for (let index = 0; index < lookahead; index++) {
        await network.provider.send("evm_mine");
      }

      balanceBefore = await pnk.balanceOf(deployer);
    };

    const reachStakingPhaseAfterDrawing = async () => {
      await randomizer.relay(rng.address, 0, ethers.utils.randomBytes(32));
      await sortition.passPhase(); // Generating -> Drawing
      await core.draw(0, 5000);
      await sortition.passPhase(); // Drawing -> Staking
    };

    describe("When decreasing then increasing back stake", async () => {
      before("Setup", async () => {
        await deploy();
        await reachDrawingPhase();
      });

      it("Should be outside the Staking phase", async () => {
        expect(await sortition.phase()).to.be.equal(1); // Drawing
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          BigNumber.from(0),
          PNK(2000),
          BigNumber.from(2),
        ]);
      });

      it("Should delay the stake decrease", async () => {
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(0);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(0);
        await expect(core.setStake(2, PNK(1000)))
          .to.emit(core, "StakeDelayedNotTransferred")
          .withArgs(deployer, 2, PNK(1000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          BigNumber.from(0),
          PNK(2000),
          BigNumber.from(2),
        ]); // stake unchanged, delayed
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore); // No PNK transfer yet
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(1);
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(1);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([deployer, 2, PNK(1000), false]);
      });

      it("Should delay the stake increase back to the previous amount", async () => {
        balanceBefore = await pnk.balanceOf(deployer);
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(1);
        await expect(core.setStake(2, PNK(2000)))
          .to.emit(core, "StakeDelayedNotTransferred")
          .withArgs(deployer, 2, PNK(2000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          BigNumber.from(0),
          PNK(2000),
          BigNumber.from(2),
        ]); // stake unchanged, delayed
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore); // No PNK transfer yet
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(2);
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(2);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 1st delayed stake got deleted
        expect(await sortition.delayedStakes(2)).to.be.deep.equal([deployer, 2, PNK(2000), false]);
      });

      it("Should execute the delayed stakes but the stakes should remain the same", async () => {
        await reachStakingPhaseAfterDrawing();
        balanceBefore = await pnk.balanceOf(deployer);
        await expect(sortition.executeDelayedStakes(10)).to.emit(core, "StakeSet").withArgs(deployer, 2, PNK(2000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          PNK(300), // we're the only juror so we are drawn 3 times
          PNK(2000),
          BigNumber.from(2),
        ]); // stake unchanged, delayed
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore); // No PNK transfer yet
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(2);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(3);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 1st delayed stake got deleted
        expect(await sortition.delayedStakes(2)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 2nd delayed stake got deleted
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(0); // no delayed stakes left
      });
    });

    describe("When increasing then decreasing back stake", async () => {
      before("Setup", async () => {
        await deploy();
        await reachDrawingPhase();
      });

      it("Should be outside the Staking phase", async () => {
        expect(await sortition.phase()).to.be.equal(1); // Drawing
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          BigNumber.from(0),
          PNK(2000),
          BigNumber.from(2),
        ]);
      });

      it("Should transfer PNK but delay the stake increase", async () => {
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(0);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        await pnk.approve(core.address, PNK(1000));
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(0);
        await expect(core.setStake(2, PNK(3000)))
          .to.emit(core, "StakeDelayedAlreadyTransferred")
          .withArgs(deployer, 2, PNK(3000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(5000),
          BigNumber.from(0),
          PNK(3000),
          BigNumber.from(2),
        ]); // stake has changed immediately, WARNING: this is misleading because it's not actually added to the SortitionSumTree
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore.sub(PNK(1000))); // PNK is transferred out of the juror's account
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(1);
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(1);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([deployer, 2, PNK(3000), true]);
      });

      it("Should cancel out the stake decrease back", async () => {
        balanceBefore = await pnk.balanceOf(deployer);
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(1);
        await expect(core.setStake(2, PNK(2000)))
          .to.emit(core, "StakeDelayedNotTransferred")
          .withArgs(deployer, 2, PNK(2000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          BigNumber.from(0),
          PNK(2000),
          BigNumber.from(2),
        ]); // stake has changed immediately
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore.add(PNK(1000))); // PNK is sent back to the juror
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(2);
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(2);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(1);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 1st delayed stake got deleted
        expect(await sortition.delayedStakes(2)).to.be.deep.equal([deployer, 2, PNK(2000), false]);
      });

      it("Should execute the delayed stakes but the stakes should remain the same", async () => {
        await reachStakingPhaseAfterDrawing();
        balanceBefore = await pnk.balanceOf(deployer);
        await expect(sortition.executeDelayedStakes(10)).to.emit(core, "StakeSet").withArgs(deployer, 2, PNK(2000));
        expect(await core.getJurorBalance(deployer, 2)).to.be.deep.equal([
          PNK(4000),
          PNK(300), // we're the only juror so we are drawn 3 times
          PNK(2000),
          BigNumber.from(2),
        ]); // stake unchanged, delayed
        expect(await pnk.balanceOf(deployer)).to.be.equal(balanceBefore); // No PNK transfer yet
        expect(await sortition.delayedStakeWriteIndex()).to.be.equal(2);
        expect(await sortition.delayedStakeReadIndex()).to.be.equal(3);
        expect(await sortition.delayedStakes(1)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 1st delayed stake got deleted
        expect(await sortition.delayedStakes(2)).to.be.deep.equal([ethers.constants.AddressZero, 0, 0, false]); // the 2nd delayed stake got deleted
        expect(await sortition.latestDelayedStakeIndex(deployer, 2)).to.be.equal(0); // no delayed stakes left
      });
    });
  });

  describe("When a juror is inactive", async () => {
    before("Setup", async () => {
      await deploy();
    });

    it("Should unstake from all courts", async () => {
      const arbitrationCost = ETH(0.1).mul(3);

      await core.createCourt(1, false, PNK(1000), 1000, ETH(0.1), 3, [0, 0, 0, 0], 3, [1]); // Parent - general court, Classic dispute kit

      await pnk.approve(core.address, PNK(4000));
      await core.setStake(1, PNK(2000));
      await core.setStake(2, PNK(2000));

      expect(await core.getJurorCourtIDs(deployer)).to.be.deep.equal([BigNumber.from("1"), BigNumber.from("2")]);

      await core.functions["createDispute(uint256,bytes)"](2, extraData, { value: arbitrationCost });

      await network.provider.send("evm_increaseTime", [2000]); // Wait for minStakingTime
      await network.provider.send("evm_mine");

      const lookahead = await sortition.rngLookahead();
      await sortition.passPhase(); // Staking -> Generating
      for (let index = 0; index < lookahead; index++) {
        await network.provider.send("evm_mine");
      }
      await randomizer.relay(rng.address, 0, ethers.utils.randomBytes(32));
      await sortition.passPhase(); // Generating -> Drawing

      await core.draw(0, 5000);

      await core.passPeriod(0); // Evidence -> Voting
      await core.passPeriod(0); // Voting -> Appeal
      await core.passPeriod(0); // Appeal -> Execution

      await sortition.passPhase(); // Drawing -> Staking. Change so we don't deal with delayed stakes

      expect(await core.getJurorCourtIDs(deployer)).to.be.deep.equal([BigNumber.from("1"), BigNumber.from("2")]);

      await core.execute(0, 0, 1); // 1 iteration should unstake from both courts

      expect(await core.getJurorCourtIDs(deployer)).to.be.deep.equal([]);
    });
  });
});