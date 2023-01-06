import { Character } from "../model/Character";
import { EditionData } from "../model/data/EditionData";
import { RoomData } from "../model/data/RoomData";
import { ScenarioData, ScenarioRule } from "../model/data/ScenarioData";
import { EntityValueFunction } from "../model/Entity";
import { Game, GameState } from "../model/Game";
import { MonsterType } from "../model/MonsterType";
import { GameScenarioModel, Scenario } from "../model/Scenario";
import { gameManager } from "./GameManager";
import { settingsManager } from "./SettingsManager";

export class ScenarioManager {

  game: Game;

  constructor(game: Game) {
    this.game = game;
  }


  setScenario(scenario: Scenario | undefined) {
    this.game.scenario = scenario ? new Scenario(scenario, scenario.revealedRooms, scenario.custom) : undefined;
    if (scenario && !scenario.custom) {
      const scenarioData = gameManager.scenarioData().find((scenarioData) => scenarioData.index == scenario.index && scenarioData.edition == scenario.edition && scenarioData.group == scenario.group);
      if (!scenarioData) {
        console.error("Could not find scenario data!");
        return;
      }
      const editionData: EditionData | undefined = gameManager.editionData.find((value) => value.edition == scenario.edition);
      if (!editionData) {
        console.error("Could not find edition data!");
        return;
      }
      gameManager.roundManager.resetScenario();
      this.applyScenarioData(editionData, scenarioData);
    } else if (!scenario) {
      gameManager.roundManager.resetScenario();
    }
  }

  finishScenario(success: boolean = true) {
    this.game.figures.forEach((figure) => {
      if (figure instanceof Character && !figure.absent) {
        gameManager.characterManager.addXP(figure, (success ? gameManager.levelManager.experience() : 0) + figure.experience);
        figure.progress.gold += figure.loot * gameManager.levelManager.loot();
      }
    })

    if (success && this.game.party && this.game.scenario) {
      this.game.party.scenarios.push(new GameScenarioModel(this.game.scenario.index, this.game.scenario.edition, this.game.scenario.group, this.game.scenario.custom, this.game.scenario.custom ? this.game.scenario.name : "", this.game.scenario.revealedRooms));
      this.game.party.manualScenarios = this.game.party.manualScenarios.filter((identifier) => this.game.scenario && (this.game.scenario.index != identifier.index || this.game.scenario.edition != identifier.edition || this.game.scenario.group != identifier.group));
    }

    this.game.scenario = undefined;
    this.game.sections = [];
    gameManager.roundManager.resetScenario();

    this.game.figures.forEach((figure) => {
      if (figure instanceof Character) {
        figure.absent = false;
      }
    });
  }


  addSection(section: ScenarioData) {
    const editionData: EditionData | undefined = gameManager.editionData.find((value) => value.edition == section.edition);
    if (!editionData) {
      console.error("Could not find edition data!");
      return;
    }

    if (!this.game.sections.some((value) => value.edition == section.edition && value.index == section.index && value.group == section.group)) {
      this.game.sections.push(new Scenario(section, []));
      this.applyScenarioData(editionData, section);
    }
  }

  applyScenarioData(editionData: EditionData, scenarioData: ScenarioData) {
    if ((settingsManager.settings.disableStandees || !settingsManager.settings.scenarioRooms || !scenarioData.rooms || scenarioData.rooms.length == 0) && scenarioData.monsters) {
      scenarioData.monsters.forEach((name) => {
        gameManager.monsterManager.addMonsterByName(name, scenarioData.allies && scenarioData.allies.indexOf(name) != -1, editionData);
      });
    } else {
      scenarioData.rooms.filter((roomData) => roomData.initial).forEach((roomData) => {
        this.openDoor(roomData, editionData, scenarioData);
      })
    }

    if (scenarioData.solo) {
      gameManager.game.figures.forEach((figure) => {
        if (figure instanceof Character && (figure.name != scenarioData.solo || figure.edition != scenarioData.edition)) {
          figure.absent = true;
        }
      });

      if (!gameManager.game.figures.some((figure) => figure instanceof Character && figure.name == scenarioData.solo && figure.edition == scenarioData.edition)) {
        const characterData = gameManager.charactersData().find((characterData) => characterData.name == scenarioData.solo && characterData.edition == scenarioData.edition);
        if (characterData) {
          gameManager.characterManager.addCharacter(characterData, 1);
        } else {
          console.error("Solo Scenario Character not found: '" + scenarioData.solo + "' (" + scenarioData.name + ")");
        }
      }
    }

    if (scenarioData.objectives) {
      scenarioData.objectives.forEach((objectiveData) => {
        const count = EntityValueFunction(objectiveData.count || 1);
        if (count > 1) {
          for (let i = 0; i < count; i++) {
            gameManager.characterManager.addObjective(objectiveData, objectiveData.name + " " + (i + 1));
          }
        } else {
          gameManager.characterManager.addObjective(objectiveData);
        }
      })
    }

    if (scenarioData.lootDeckConfig) {
      gameManager.lootManager.apply(this.game.lootDeck, scenarioData.lootDeckConfig);
    }
  }

  openDoor(roomData: RoomData, editionData: EditionData, scenarioData: ScenarioData) {
    if (this.game.scenario) {
      this.game.scenario.revealedRooms = this.game.scenario.revealedRooms || [];
      this.game.scenario.revealedRooms.push(roomData.roomNumber);
    }

    if (roomData.monster) {
      roomData.monster.forEach((monsterStandeeData) => {


        let type: MonsterType | undefined = monsterStandeeData.type;

        if (!type) {
          const charCount = this.game.figures.filter((figure) => figure instanceof Character && !figure.absent).length;
          if (charCount <= 2) {
            type = monsterStandeeData.player2;
          } else if (charCount == 3) {
            type = monsterStandeeData.player3;
          } else {
            type = monsterStandeeData.player4;
          }
        }

        if (type) {
          const monster = gameManager.monsterManager.addMonsterByName(monsterStandeeData.name, scenarioData.allies && scenarioData.allies.indexOf(monsterStandeeData.name) != -1, editionData);

          if (monster && settingsManager.settings.automaticStandees && gameManager.monsterManager.monsterEntityCount(monster) < monster.count) {
            let number = (monster.entities.length + 1) * -1;

            if (settingsManager.settings.randomStandees) {
              number = Math.floor(Math.random() * monster.count) + 1;
              while (monster.entities.some((monsterEntity) => monsterEntity.number == number)) {
                number = Math.floor(Math.random() * monster.count) + 1;
              }
            }
            if (monster.boss) {
              type = MonsterType.boss;
            }

            gameManager.monsterManager.addMonsterEntity(monster, number, type);
          }
        }
      })
    }
  }

  scenarioData(edition: string | undefined): ScenarioData[] {
    const scenarios = gameManager.editionData.filter((editionData) => settingsManager.settings.editions.indexOf(editionData.edition) != -1).map((editionData) => editionData.scenarios).flat();

    if (!edition) {
      return scenarios;
    }

    if (!this.game.party.campaignMode || !scenarios.some((scenarioData) => scenarioData.initial)) {
      return scenarios.filter((scenarioData) => scenarioData.edition == edition);
    }

    return scenarios.filter((scenarioData) => {

      if (scenarioData.edition != edition) {
        return false;
      }

      if (scenarioData.initial) {
        return true;
      }

      if (this.game.party.scenarios.find((identifier) => scenarioData.index == identifier.index && scenarioData.edition == identifier.edition && scenarioData.group == identifier.group)) {
        return true;
      }

      if (this.game.party.manualScenarios.find((identifier) => scenarioData.index == identifier.index && scenarioData.edition == identifier.edition && scenarioData.group == identifier.group)) {
        return true;
      }

      let unlocked: boolean = false;
      let requires: boolean = !scenarioData.requires || scenarioData.requires.length == 0;
      this.game.party.scenarios.forEach((identifier) => {
        const scenario = scenarios.find((value) => value.index == identifier.index && value.edition == identifier.edition && value.group == identifier.group);

        if (scenario && scenario.group == scenarioData.group) {
          if ((scenario.unlocks && scenario.unlocks.indexOf(scenarioData.index) != -1)) {
            unlocked = true;
          }
        }
      })

      if (!requires) {
        requires = scenarioData.requires.some((requires) => requires.every((require) => this.game.party.scenarios.find((identifier) => identifier.index == require && identifier.group == scenarioData.group && identifier.edition == scenarioData.edition)));
      }

      return unlocked && requires;
    });
  }

  isBlocked(scenarioData: ScenarioData): boolean {
    let blocked = false;
    const editionData = gameManager.editionData.find((editionData) => editionData.edition == scenarioData.edition);
    if (editionData) {
      this.game.party.scenarios.forEach((identifier) => {
        const scenario = editionData.scenarios.find((value) => value.index == identifier.index && value.edition == identifier.edition && value.group == identifier.group);
        if (scenario) {
          if (scenario.blocks && scenario.blocks.indexOf(scenarioData.index) != -1) {
            blocked = true;
          }
        }
      })
    }
    return blocked;
  }

  applyScenarioRules() {
    this.game.scenarioRules = [];
    const scenario = this.game.scenario;
    if (scenario && scenario.rules) {
      scenario.rules.forEach((rule, index) => {
        this.applyScenarioRule(scenario, rule, index, false);
      })
    }

    if (this.game.sections) {
      this.game.sections.forEach((section) => {
        if (section.rules) {
          section.rules.forEach((rule, index) => {
            this.applyScenarioRule(section, rule, index, true);
          })
        }
      })
    }
  }

  applyScenarioRule(scenarioData: ScenarioData, rule: ScenarioRule, index: number, section: boolean) {
    let round = rule.round || 'false';

    while (round.indexOf('R') != -1) {
      round = round.replace('R', '' + this.game.round);
    }

    while (round.indexOf('C') != -1) {
      round = round.replace('C', '' + this.game.figures.filter((figure) => figure instanceof Character && !figure.absent).length);
    }
    try {
      if (eval(round) && (this.game.state == GameState.next && !rule.start || this.game.state == GameState.draw && rule.start)) {
        this.game.scenarioRules.push({ "edition": scenarioData.edition, "scenario": scenarioData.index, "group": scenarioData.group, "index": index + 1, "section": section });
      }
    } catch (error) {
      console.warn("Cannot apply scenario rule: '" + rule.round + "'", "index: " + index, error);
    }
  }

  scenarioUndoArgs(scenario: Scenario | undefined = undefined): string[] {
    scenario = scenario || gameManager.game.scenario;
    if (!scenario) {
      return ["", "", ""];
    }

    return [scenario.index, "data.scenario." + scenario.name, scenario.custom ? 'scenario.custom' : 'data.edition.' + scenario.edition];
  }

  scenarioDataForModel(model: GameScenarioModel): ScenarioData | undefined {
    if (model.isCustom) {
      return new ScenarioData(model.custom, "", [], [], [], [], [], [], [], [], "", [], "");
    }

    const scenarioData = gameManager.scenarioData().find((scenarioData) => scenarioData.index == model.index && scenarioData.edition == model.edition && scenarioData.group == model.group);
    if (!scenarioData) {
      console.warn("Invalid scenario data:", model);
      return undefined;
    }

    return JSON.parse(JSON.stringify(scenarioData));
  }

  sectionDataForModel(model: GameScenarioModel): ScenarioData | undefined {
    const sectionData = gameManager.sectionData().find((sectionData) => sectionData.index == model.index && sectionData.edition == model.edition && sectionData.group == model.group);
    if (!sectionData) {
      console.warn("Invalid section data:", model);
      return undefined;
    }

    return JSON.parse(JSON.stringify(sectionData));
  }

  toModel(scenarioData: ScenarioData, revealedRooms: number[], custom: boolean = false, customName: string = ""): GameScenarioModel {
    return new GameScenarioModel(scenarioData.index, scenarioData.edition, scenarioData.group, custom, customName, JSON.parse(JSON.stringify(revealedRooms)));
  }
}
