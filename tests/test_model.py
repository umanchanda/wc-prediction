import unittest

from fixtures import Fixture, normalize_fixtures
from model import PremierLeagueModel


class FixtureNormalizationTests(unittest.TestCase):
    def test_extracts_premier_league_fixture_from_team_payload(self):
        payload = {
            "fixtures": {
                "allFixtures": {
                    "fixtures": [{
                        "id": 123,
                        "homeTeamName": "Arsenal",
                        "awayTeamName": "Chelsea",
                        "leagueName": "Premier League",
                        "seasonName": "2026/2027",
                        "status": {"utcTime": "2026-08-15T14:00:00.000Z"},
                        "round": 1,
                    }]
                }
            }
        }
        fixtures = normalize_fixtures(payload)
        self.assertEqual(len(fixtures), 1)
        self.assertEqual(fixtures[0].home, "Arsenal")
        self.assertEqual(fixtures[0].round, 1)


class PredictionTests(unittest.TestCase):
    def test_predicts_a_valid_scoreline_and_probabilities(self):
        fixtures = [
            Fixture("played", "Arsenal", "Chelsea", None, 1, 2, 0),
            Fixture("next", "Arsenal", "Chelsea", "2026-08-22T14:00:00Z", 2),
        ]
        prediction = PremierLeagueModel(fixtures).predict(fixtures[-1])
        self.assertRegex(prediction.predicted_score, r"^\d+-\d+$")
        self.assertGreater(prediction.expected_home_goals, 0)
        self.assertAlmostEqual(
            prediction.home_win_probability + prediction.draw_probability + prediction.away_win_probability,
            1.0,
            delta=0.01,
        )
