import XCTest
@testable import GSData

final class DataTests: XCTestCase {
    func testBundledLeagueLoads() throws {
        let league = try DataLoader.bundledLeague()
        XCTAssertGreaterThanOrEqual(league.teams.count, 2)
        for t in league.teams {
            XCTAssertGreaterThanOrEqual(t.roster.count, 14, t.id)
            XCTAssertEqual(t.players(at: .qb).count, 1)
            XCTAssertNotNil(RGBAcheck(t.colors.primary))
        }
        let stars = league.teams.flatMap(\.roster).filter { $0.spiritPlay != nil }
        XCTAssertGreaterThanOrEqual(stars.count, 6, "every team needs unique Spirit Play stars")
        XCTAssertEqual(Set(stars.compactMap(\.spiritPlay)).count, stars.count, "Spirit Plays must be unique")
    }

    private func RGBAcheck(_ s: String) -> Bool? { s.hasPrefix("#") && s.count == 7 ? true : nil }

    /// Guard rail for "all content is original IP": no team may reuse a real
    /// pro league nickname. (Not a substitute for a trademark search.)
    func testNoRealProTeamNicknames() throws {
        let banned = ["cardinals", "falcons", "ravens", "bills", "panthers", "bears", "bengals", "browns",
                      "cowboys", "broncos", "lions", "packers", "texans", "colts", "jaguars", "chiefs",
                      "raiders", "chargers", "rams", "dolphins", "vikings", "patriots", "saints", "giants",
                      "jets", "eagles", "steelers", "49ers", "seahawks", "buccaneers", "titans", "commanders",
                      "nfl", "ncaa", "xfl", "usfl", "ufl", "vipers", "renegades", "stallions", "argonauts",
                      "roughriders", "alouettes", "blue bombers", "tiger-cats", "redblacks", "stampeders", "elks"]
        for t in try DataLoader.bundledLeague().teams {
            let name = "\(t.city) \(t.name)".lowercased()
            for b in banned { XCTAssertFalse(name.contains(b), "\(name) contains '\(b)'") }
        }
    }

    func testValidationRejectsBadRatings() {
        let json = """
        {"version":1,"teams":[{"id":"t","city":"C","name":"N","abbreviation":"TT","archetype":"flashy",
        "colors":{"primary":"#000000","secondary":"#000000","accent":"#000000"},
        "roster":[{"id":"p","firstName":"A","lastName":"B","number":1,"position":"qb",
        "ratings":{"speed":120,"acceleration":50,"agility":50,"strength":50,"balance":50,"catching":50,
        "throwPower":50,"throwAccuracy":50,"weightLbs":200}}]}]}
        """
        XCTAssertThrowsError(try DataLoader.decodeLeague(from: Data(json.utf8)))
    }
}
