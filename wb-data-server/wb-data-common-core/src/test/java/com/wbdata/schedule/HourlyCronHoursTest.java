package com.wbdata.schedule;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

class HourlyCronHoursTest {

    @Test
    void parseHourlyCronHours_acceptsFullDayStepRangeAndDiscreteForms() {
        Set<Integer> allHours = IntStream.rangeClosed(0, 23).boxed().collect(java.util.stream.Collectors.toSet());
        assertThat(HourlyCronHours.parseHourlyCronHours("15 * * * *")).contains(allHours);
        assertThat(HourlyCronHours.parseHourlyCronHours("15 */6 * * *")).contains(Set.of(0, 6, 12, 18));
        assertThat(HourlyCronHours.parseHourlyCronHours("0 8-12 * * *")).contains(Set.of(8, 9, 10, 11, 12));
        assertThat(HourlyCronHours.parseHourlyCronHours("30 8-22/3 * * *")).contains(Set.of(8, 11, 14, 17, 20));
        assertThat(HourlyCronHours.parseHourlyCronHours("10 14,1,3,3 * * *"))
                .hasValueSatisfying(hours -> assertThat(hours).containsExactly(1, 3, 14));
        assertThat(HourlyCronHours.parseHourlyCronHours("0 22,23,0,1 * * *"))
                .hasValueSatisfying(hours -> assertThat(hours).containsExactly(0, 1, 22, 23));
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1-3,14 * * *"))
                .hasValueSatisfying(hours -> assertThat(hours).containsExactly(1, 2, 3, 14));
    }

    @Test
    void parseHourlyCronHours_rejectsSingleHourReversedRangeOutOfRangeAndCustomFields() {
        assertThat(HourlyCronHours.parseHourlyCronHours("0 14 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 14,14 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 22-6 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 8-8 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 10-14/6 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 */24 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 */0 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1,24 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1,,3 * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1,3, * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("60 * * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("*/5 * * * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1,3 * * 1")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("0 1,3 1 * *")).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours(null)).isEmpty();
        assertThat(HourlyCronHours.parseHourlyCronHours("")).isEmpty();
    }

    @Test
    void missingHours_computesDifferenceWhenBothAreValidHourlyCrons() {
        assertThat(HourlyCronHours.missingHours("30 1,3,14 * * *", "0 * * * *"))
                .contains(List.of());
        assertThat(HourlyCronHours.missingHours("30 1,3,14 * * *", "0 8-22 * * *"))
                .contains(List.of(1, 3));
        assertThat(HourlyCronHours.missingHours("30 8-12/2 * * *", "0 8,10,12 * * *"))
                .contains(List.of());
        assertThat(HourlyCronHours.missingHours("30 14 * * *", "0 * * * *"))
                .isEmpty();
    }

    @Test
    void formatHours_formatsShortAndTruncatedLists() {
        assertThat(HourlyCronHours.formatHours(List.of(14, 1, 3))).isEqualTo("01、03、14 时");
        assertThat(HourlyCronHours.formatHours(List.of(0, 2, 4, 6, 8, 10, 12, 14)))
                .isEqualTo("00、02、04、06、08、10 等 8 个小时");
        assertThat(HourlyCronHours.formatHours(List.of())).isEmpty();
    }
}
