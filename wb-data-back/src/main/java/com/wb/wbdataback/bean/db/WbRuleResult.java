package com.wb.wbdataback.bean.db;

import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Entity;

@Entity
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class WbRuleResult extends BaseBean

{

    private Long wbRuleId;
    private Double result;
    private int isException;

}
