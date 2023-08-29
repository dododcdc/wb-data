package com.wb.wbdataback.bean.db;

import com.wb.wbdataback.bean.BaseBean;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.Entity;
import javax.persistence.JoinColumn;
import javax.persistence.OneToOne;

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

    @OneToOne
    @JoinColumn(name = "wbRuleId",insertable = false,updatable = false )
    private WbRule wbRule;

}
